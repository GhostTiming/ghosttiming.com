import type { PoolClient } from "pg";
import { upsertTaskTimelineActivity } from "./audit";
import { parseTaskEventType } from "./domain";

export type NextStepTaskPlan =
  | { action: "upsert"; dueOn: string; title: string }
  | { action: "clear" };

export function nextStepTaskPlan(input: {
  nextStepOn?: string | null;
  nextStepNote?: string | null;
}): NextStepTaskPlan {
  const dueOn = input.nextStepOn?.trim() ?? "";
  const title = input.nextStepNote?.trim() ?? "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(dueOn) && title) {
    return { action: "upsert", dueOn, title };
  }
  return { action: "clear" };
}

async function findOpenNextStepTask(
  client: PoolClient,
  prospectId: string,
  current: { dueOn?: string | null; title?: string | null },
  previous: { dueOn?: string | null; title?: string | null },
) {
  const result = await client.query<{ id: string }>(
    `
      SELECT t.id::text
      FROM crm.tasks t
      WHERE t.prospect_id = $1::uuid
        AND t.status = 'open'
        AND (
          EXISTS (
            SELECT 1
            FROM crm.activities a
            WHERE a.metadata->>'taskId' = t.id::text
              AND a.metadata->>'source' = 'next_step'
          )
          OR (
            $2::date IS NOT NULL AND $3::text IS NOT NULL
            AND (t.due_at AT TIME ZONE 'America/New_York')::date = $2::date
            AND COALESCE(NULLIF(btrim(t.notes), ''), t.title) = $3
          )
          OR (
            $4::date IS NOT NULL AND $5::text IS NOT NULL
            AND (t.due_at AT TIME ZONE 'America/New_York')::date = $4::date
            AND COALESCE(NULLIF(btrim(t.notes), ''), t.title) = $5
          )
        )
      ORDER BY
        CASE WHEN EXISTS (
          SELECT 1 FROM crm.activities a
          WHERE a.metadata->>'taskId' = t.id::text
            AND a.metadata->>'source' = 'next_step'
        ) THEN 0 ELSE 1 END,
        t.updated_at DESC
      LIMIT 1
    `,
    [
      prospectId,
      current.dueOn ?? null,
      current.title?.trim() || null,
      previous.dueOn ?? null,
      previous.title?.trim() || null,
    ],
  );
  return result.rows[0]?.id;
}

export async function syncProspectNextStepTask(
  client: PoolClient,
  input: {
    prospectId: string;
    assignedUserId: string;
    actor: { id: string; name: string };
    previous: { nextStepOn: string | null; nextStepNote: string | null };
    nextStepOn?: string | null;
    nextStepNote?: string | null;
  },
) {
  const plan = nextStepTaskPlan(input);
  const previousTitle = input.previous.nextStepNote?.trim() || null;
  const existingId = await findOpenNextStepTask(
    client,
    input.prospectId,
    plan.action === "upsert" ? { dueOn: plan.dueOn, title: plan.title } : {},
    { dueOn: input.previous.nextStepOn, title: previousTitle },
  );

  if (plan.action === "clear") {
    if (!existingId) return null;
    await client.query(
      `UPDATE crm.tasks
       SET status = 'canceled', updated_at = now()
       WHERE id = $1::uuid AND status = 'open'`,
      [existingId],
    );
    return existingId;
  }

  let taskId = existingId;
  if (taskId) {
    await client.query(
      `UPDATE crm.tasks
       SET title = $2,
           notes = $2,
           due_at = $3::date::timestamp AT TIME ZONE 'America/New_York',
           updated_at = now()
       WHERE id = $1::uuid AND status = 'open'`,
      [taskId, plan.title, plan.dueOn],
    );
  } else {
    const created = await client.query<{ id: string }>(
      `INSERT INTO crm.tasks
         (prospect_id, assigned_user_id, title, notes, due_at, status)
       VALUES (
         $1::uuid, $2::uuid, $3, $3,
         $4::date::timestamp AT TIME ZONE 'America/New_York',
         'open'
       )
       RETURNING id::text`,
      [input.prospectId, input.assignedUserId, plan.title, plan.dueOn],
    );
    taskId = created.rows[0].id;
  }

  await upsertTaskTimelineActivity(client, {
    taskId,
    prospectId: input.prospectId,
    eventType: parseTaskEventType(plan.title),
    description: plan.title,
    actor: input.actor,
    metadata: { source: "next_step" },
  });
  return taskId;
}
