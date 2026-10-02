import type { PoolClient } from "pg";

/** Prospect pipeline key whose label is Contacting. Cadence only runs here. */
export const CADENCE_CONTACTING_STAGE_KEY = "cold";
export const CADENCE_LEFT_CONTACTING_REASON = "left_contacting";

type Queryable = { query: PoolClient["query"] };

export type CadenceExitActor = {
  actorType: "human" | "ai" | "system";
  actorName: string;
  actorUserId?: string | null;
};

/**
 * Cancel scheduled touches and close active enrollments for leads that are
 * not in Contacting. Safe to call more than once.
 * Stage updates also run crm.exit_cadence_outside_contacting().
 */
export async function exitCadencesOutsideContacting(
  client: Queryable,
  input: {
    prospectIds?: string[];
    actor?: CadenceExitActor;
  } = {},
): Promise<number> {
  const actorType = input.actor?.actorType ?? "system";
  const actorName = input.actor?.actorName?.trim() || "System";
  const actorUserId = actorType === "human" ? input.actor?.actorUserId ?? null : null;
  const result = await client.query(
    `
      WITH leaving AS (
        SELECT enrollment.id, enrollment.prospect_id
        FROM crm.cadence_enrollments enrollment
        JOIN crm.prospects prospect ON prospect.id = enrollment.prospect_id
        JOIN crm.pipeline_stages stage ON stage.id = prospect.stage_id
        WHERE enrollment.status = 'active'
          AND stage.pipeline = 'prospect'
          AND stage.key <> $1
          AND ($2::uuid[] IS NULL OR enrollment.prospect_id = ANY($2::uuid[]))
      ),
      canceled AS (
        UPDATE crm.cadence_step_sends send
        SET status = 'canceled',
            canceled_at = now(),
            updated_at = now()
        FROM leaving
        WHERE send.enrollment_id = leaving.id
          AND send.status = 'scheduled'
      ),
      exited AS (
        UPDATE crm.cadence_enrollments enrollment
        SET status = 'exited_manual',
            exited_at = now(),
            exited_reason = $3,
            updated_at = now()
        FROM leaving
        WHERE enrollment.id = leaving.id
          AND enrollment.status = 'active'
        RETURNING enrollment.id, enrollment.prospect_id
      )
      INSERT INTO crm.activities (
        prospect_id, type, body, actor_type, actor_user_id, actor_name, metadata
      )
      SELECT
        exited.prospect_id,
        'note',
        'Removed from cadence because this lead left Contacting.',
        $4::crm.actor_type,
        $5::uuid,
        $6,
        jsonb_build_object(
          'source', 'cadence',
          'reason', $3,
          'enrollmentId', exited.id
        )
      FROM exited
    `,
    [
      CADENCE_CONTACTING_STAGE_KEY,
      input.prospectIds ?? null,
      CADENCE_LEFT_CONTACTING_REASON,
      actorType,
      actorUserId,
      actorName,
    ],
  );
  return result.rowCount ?? 0;
}
