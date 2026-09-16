import type { PoolClient } from "pg";
import {
  parseClosedLostDetails,
  parseDisqualifiedDetails,
  parseUnqualifiedDetails,
  shouldCloseProspect,
  shouldMarkDoNotContact,
  type ClosedLostDetails,
  type UserActivityType,
} from "./domain";
import { eventMatchKey, isGenericEventName } from "./event-matching";
import { cancelOpenProspectTasks, PAST_EVENT_STAGE_KEY } from "./past-events";

export type RecordActivityInput = {
  prospectId: string;
  type: UserActivityType;
  body: string;
  disposition?: string;
  occurredAt?: Date;
  actorType: "human" | "ai" | "system";
  actorUserId?: string;
  actorName: string;
  metadata?: Record<string, unknown>;
  followUp?: {
    title: string;
    dueAt: Date;
    assignedUserId: string;
  };
};

export async function insertActivityAndFollowUp(
  client: PoolClient,
  input: RecordActivityInput,
) {
  const activity = await client.query<{ id: string }>(
    `
      INSERT INTO crm.activities
        (
          prospect_id,
          type,
          body,
          disposition,
          occurred_at,
          actor_type,
          actor_user_id,
          actor_name,
          metadata
        )
      VALUES (
        $1::uuid,
        $2::crm.activity_type,
        $3,
        $4,
        COALESCE($5::timestamptz, now()),
        $6::crm.actor_type,
        $7::uuid,
        $8,
        $9::jsonb
      )
      RETURNING id::text
    `,
    [
      input.prospectId,
      input.type,
      input.body,
      input.disposition ?? null,
      input.occurredAt ?? null,
      input.actorType,
      input.actorUserId ?? null,
      input.actorName,
      JSON.stringify(input.metadata ?? {}),
    ],
  );

  let taskId: string | undefined;
  if (input.followUp) {
    const task = await client.query<{ id: string }>(
      `
        INSERT INTO crm.tasks
          (prospect_id, source_activity_id, assigned_user_id, title, due_at)
        VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5)
        RETURNING id::text
      `,
      [
        input.prospectId,
        activity.rows[0].id,
        input.followUp.assignedUserId,
        input.followUp.title,
        input.followUp.dueAt,
      ],
    );
    taskId = task.rows[0].id;
  }

  return { activityId: activity.rows[0].id, taskId };
}

export async function applyTerminalDisposition(
  client: PoolClient,
  prospectId: string,
  disposition: string | undefined,
) {
  if (!shouldCloseProspect(disposition)) return false;

  const stageChange = await client.query<{
    old_name: string;
    changed: boolean;
  }>(
    `
      WITH current_state AS (
        SELECT p.stage_id, old_stage.name AS old_name
        FROM crm.prospects p
        JOIN crm.pipeline_stages old_stage ON old_stage.id = p.stage_id
        WHERE p.id = $1::uuid
      ),
      closed_stage AS (
        SELECT id FROM crm.pipeline_stages
        WHERE pipeline = 'prospect' AND key = 'closed_lost'
      ),
      changed AS (
        UPDATE crm.prospects
        SET stage_id = closed_stage.id,
            closed_at = COALESCE(closed_at, now()),
            do_not_contact = do_not_contact OR $2::boolean,
            updated_at = now()
        FROM closed_stage, current_state
        WHERE prospects.id = $1::uuid
        RETURNING prospects.stage_id <> current_state.stage_id AS changed
      )
      SELECT current_state.old_name, changed.changed
      FROM current_state, changed
    `,
    [prospectId, shouldMarkDoNotContact(disposition)],
  );
  if (stageChange.rows[0]?.changed) {
    await client.query(
      `
        INSERT INTO crm.activities
          (prospect_id, type, body, actor_type, actor_name, metadata)
        VALUES (
          $1::uuid,
          'stage_change',
          $2,
          'system',
          'System',
          jsonb_build_object('reason', 'terminal_disposition')
        )
      `,
      [
        prospectId,
        `Stage changed from ${stageChange.rows[0].old_name} to Closed Lost`,
      ],
    );
  }
  return true;
}

export type StageChangeActor = {
  actorType: "human" | "ai";
  actorName: string;
  actorUserId?: string;
};

export async function changeProspectStage(
  client: PoolClient,
  prospectId: string,
  stageKey: string,
  actor: StageChangeActor,
  closedLost?: Parameters<typeof parseClosedLostDetails>[0] | ClosedLostDetails | null,
  outcome?: {
    unqualified?: { reason?: string | null; note?: string | null } | null;
    disqualified?: { reason?: string | null; note?: string | null } | null;
  } | null,
) {
  const current = await client.query<{ key: string }>(
    `
      SELECT stage.key
      FROM crm.prospects prospect
      JOIN crm.pipeline_stages stage ON stage.id = prospect.stage_id
      WHERE prospect.id = $1::uuid
      FOR UPDATE
    `,
    [prospectId],
  );
  if (!current.rows[0]) throw new Error("Prospect not found.");
  if (current.rows[0].key === stageKey) return false;

  const closedLostDetails =
    stageKey === "closed_lost" ? parseClosedLostDetails(closedLost ?? {}) : null;
  const unqualifiedDetails =
    stageKey === "unqualified"
      ? parseUnqualifiedDetails(outcome?.unqualified ?? {})
      : null;
  const disqualifiedDetails =
    stageKey === "disqualified"
      ? parseDisqualifiedDetails(outcome?.disqualified ?? {})
      : null;
  const changed = await client.query<{ old_name: string; new_name: string }>(
    `
      WITH target_stage AS (
        SELECT id, key, name
        FROM crm.pipeline_stages
        WHERE key = $2 AND pipeline = 'prospect' AND is_active = true
      ),
      current_state AS (
        SELECT p.stage_id, current_stage.name AS old_name
        FROM crm.prospects p
        JOIN crm.pipeline_stages current_stage ON current_stage.id = p.stage_id
        WHERE p.id = $1::uuid
      ),
      updated AS (
        UPDATE crm.prospects
        SET stage_id = target_stage.id,
            closed_at = CASE
              WHEN target_stage.key IN ('closed_lost', 'disqualified', 'unqualified', 'past_event')
                THEN COALESCE(closed_at, now())
              ELSE NULL
            END,
            closed_lost_reason = CASE
              WHEN target_stage.key = 'closed_lost' THEN $3
              ELSE closed_lost_reason
            END,
            closed_lost_note = CASE
              WHEN target_stage.key = 'closed_lost' THEN $4
              ELSE closed_lost_note
            END,
            circle_back_on = CASE
              WHEN target_stage.key = 'closed_lost' THEN $5::date
              ELSE circle_back_on
            END,
            unqualified_reason = CASE
              WHEN target_stage.key = 'unqualified' THEN $6
              ELSE unqualified_reason
            END,
            unqualified_note = CASE
              WHEN target_stage.key = 'unqualified' THEN $7
              ELSE unqualified_note
            END,
            disqualified_reason = CASE
              WHEN target_stage.key = 'disqualified' THEN $8
              ELSE disqualified_reason
            END,
            disqualified_note = CASE
              WHEN target_stage.key = 'disqualified' THEN $9
              ELSE disqualified_note
            END,
            updated_at = now()
        FROM target_stage, current_state
        WHERE prospects.id = $1::uuid
          AND prospects.stage_id <> target_stage.id
        RETURNING current_state.old_name, target_stage.name AS new_name
      )
      SELECT old_name, new_name FROM updated
    `,
    [
      prospectId,
      stageKey,
      closedLostDetails?.reason ?? null,
      closedLostDetails?.note ?? null,
      closedLostDetails?.circleBackOn ?? null,
      unqualifiedDetails?.reason ?? null,
      unqualifiedDetails?.note ?? null,
      disqualifiedDetails?.reason ?? null,
      disqualifiedDetails?.note ?? null,
    ],
  );
  if (!changed.rows[0]) return false;

  const reasonLabel =
    closedLostDetails?.reason ??
    unqualifiedDetails?.reason ??
    disqualifiedDetails?.reason;
  const activityBody = reasonLabel
    ? `Stage changed from ${changed.rows[0].old_name} to ${changed.rows[0].new_name} (${reasonLabel})`
    : `Stage changed from ${changed.rows[0].old_name} to ${changed.rows[0].new_name}`;

  await client.query(
    `
      INSERT INTO crm.activities
        (prospect_id, type, body, actor_type, actor_user_id, actor_name)
      VALUES ($1::uuid, 'stage_change', $2, $3::crm.actor_type, $4::uuid, $5)
    `,
    [
      prospectId,
      activityBody,
      actor.actorType,
      actor.actorUserId ?? null,
      actor.actorName,
    ],
  );
  if (stageKey === PAST_EVENT_STAGE_KEY) {
    await cancelOpenProspectTasks(client, [prospectId]);
  }
  return true;
}

export async function findOrCreateStandingEvent(
  client: PoolClient,
  input: {
    name: string;
    ownerOrganizationId?: string | null;
    website?: string | null;
    notes?: string | null;
    sourceType?: string;
  },
) {
  const key = eventMatchKey(input.name);
  if (key && !isGenericEventName(input.name)) {
    const existing = await client.query<{ id: string; name: string }>(
      `SELECT id::text, name FROM crm.events WHERE archived_at IS NULL`,
    );
    const match = existing.rows.find((row) => eventMatchKey(row.name) === key);
    if (match) {
      await client.query(
        `UPDATE crm.events SET
           default_owner_organization_id =
             COALESCE(default_owner_organization_id, $2::uuid),
           website = COALESCE(website, $3),
           notes = COALESCE(notes, $4),
           updated_at = now()
         WHERE id = $1::uuid`,
        [
          match.id,
          input.ownerOrganizationId ?? null,
          input.website ?? null,
          input.notes ?? null,
        ],
      );
      return match.id;
    }
  }

  const created = await client.query<{ id: string }>(
    `INSERT INTO crm.events
      (name, source_type, default_owner_organization_id, website, notes)
     VALUES ($1, $2, $3::uuid, $4, $5)
     RETURNING id::text`,
    [
      input.name,
      input.sourceType ?? "manual",
      input.ownerOrganizationId ?? null,
      input.website ?? null,
      input.notes ?? null,
    ],
  );
  return created.rows[0].id;
}
