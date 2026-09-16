import type { PoolClient } from "pg";
import { closedProspectStageKeys } from "./domain";

export const PAST_EVENT_STAGE_KEY = "past_event";
export const PAST_EVENT_STAGE_NAME = "Past events";

const closedStageSql = closedProspectStageKeys
  .map((key) => `'${key}'`)
  .join(", ");

export function isPastEventDateSql(timestampExpr: string) {
  return `(
    ${timestampExpr} IS NOT NULL
    AND (${timestampExpr} AT TIME ZONE 'America/New_York')::date
      < (now() AT TIME ZONE 'America/New_York')::date
  )`;
}

export function effectiveProspectStageKeySql(
  stageKeyExpr: string,
  timestampExpr: string,
) {
  return `CASE
    WHEN ${stageKeyExpr} IN (${closedStageSql}) THEN ${stageKeyExpr}
    WHEN ${isPastEventDateSql(timestampExpr)} THEN '${PAST_EVENT_STAGE_KEY}'
    ELSE ${stageKeyExpr}
  END`;
}

export function effectiveProspectStageNameSql(
  stageKeyExpr: string,
  stageNameExpr: string,
  timestampExpr: string,
) {
  return `CASE
    WHEN ${stageKeyExpr} IN (${closedStageSql}) THEN ${stageNameExpr}
    WHEN ${isPastEventDateSql(timestampExpr)} THEN '${PAST_EVENT_STAGE_NAME}'
    ELSE ${stageNameExpr}
  END`;
}

export async function cancelOpenProspectTasks(
  client: PoolClient,
  prospectIds: string[],
) {
  if (!prospectIds.length) return 0;
  const canceled = await client.query(
    `UPDATE crm.tasks
     SET status = 'canceled', updated_at = now()
     WHERE prospect_id = ANY($1::uuid[])
       AND status = 'open'
     RETURNING id`,
    [prospectIds],
  );
  return canceled.rowCount ?? 0;
}

export async function filePastProspects(
  client: PoolClient,
  prospectIds?: string[],
) {
  const due = await client.query<{ id: string }>(
    `
      SELECT prospect.id::text
      FROM crm.prospects prospect
      JOIN crm.pipeline_stages stage ON stage.id = prospect.stage_id
      LEFT JOIN crm.event_occurrences occurrence
        ON occurrence.id = prospect.occurrence_id
      LEFT JOIN catalog.race_editions edition
        ON edition.id = prospect.race_edition_id
      LEFT JOIN catalog.race_listings listing
        ON listing.id = prospect.race_listing_id
      WHERE prospect.archived_at IS NULL
        AND stage.pipeline = 'prospect'
        AND stage.key NOT IN (${closedStageSql})
        AND ($1::uuid[] IS NULL OR prospect.id = ANY($1::uuid[]))
        AND ${isPastEventDateSql(
          "COALESCE(occurrence.race_date, edition.starts_at, listing.next_start_at)",
        )}
    `,
    [prospectIds ?? null],
  );
  const dueIds = due.rows.map((row) => row.id);
  if (!dueIds.length) return { filed: 0, canceledTasks: 0 };

  const moved = await client.query<{ id: string; old_name: string }>(
    `
      UPDATE crm.prospects AS prospect
      SET stage_id = past_stage.id,
          closed_at = COALESCE(prospect.closed_at, now()),
          updated_at = now()
      FROM crm.pipeline_stages AS past_stage,
           crm.pipeline_stages AS current_stage
      WHERE prospect.id = ANY($1::uuid[])
        AND current_stage.id = prospect.stage_id
        AND past_stage.pipeline = 'prospect'
        AND past_stage.key = '${PAST_EVENT_STAGE_KEY}'
        AND past_stage.is_active = true
      RETURNING prospect.id::text, current_stage.name AS old_name
    `,
    [dueIds],
  );

  if (moved.rows.length) {
    await client.query(
      `
        INSERT INTO crm.activities
          (prospect_id, type, body, actor_type, actor_name, metadata)
        SELECT
          moved.id::uuid,
          'stage_change',
          'Stage changed from ' || moved.old_name || ' to ${PAST_EVENT_STAGE_NAME}',
          'system',
          'System',
          jsonb_build_object('reason', 'past_event')
        FROM unnest($1::uuid[], $2::text[]) AS moved(id, old_name)
      `,
      [moved.rows.map((row) => row.id), moved.rows.map((row) => row.old_name)],
    );
  }

  const canceledTasks = await cancelOpenProspectTasks(
    client,
    moved.rows.map((row) => row.id),
  );
  return { filed: moved.rows.length, canceledTasks };
}
