ALTER TABLE "crm"."cadence_enrollments" DROP CONSTRAINT IF EXISTS "cadence_enrollments_exit_reason_check";--> statement-breakpoint
ALTER TABLE "crm"."cadence_enrollments" ADD CONSTRAINT "cadence_enrollments_exit_reason_check"
  CHECK (
    "exited_reason" IS NULL OR "exited_reason" IN (
      'declined_by_user',
      'reply_detected',
      'completed_cadence',
      'left_contacting'
    )
  );--> statement-breakpoint

WITH leaving AS (
  SELECT enrollment.id, enrollment.prospect_id
  FROM "crm"."cadence_enrollments" enrollment
  JOIN "crm"."prospects" prospect ON prospect.id = enrollment.prospect_id
  JOIN "crm"."pipeline_stages" stage ON stage.id = prospect.stage_id
  WHERE enrollment.status = 'active'
    AND stage.pipeline = 'prospect'
    AND stage.key <> 'cold'
),
canceled AS (
  UPDATE "crm"."cadence_step_sends" send
  SET status = 'canceled',
      canceled_at = now(),
      updated_at = now()
  FROM leaving
  WHERE send.enrollment_id = leaving.id
    AND send.status = 'scheduled'
),
exited AS (
  UPDATE "crm"."cadence_enrollments" enrollment
  SET status = 'exited_manual',
      exited_at = now(),
      exited_reason = 'left_contacting',
      updated_at = now()
  FROM leaving
  WHERE enrollment.id = leaving.id
    AND enrollment.status = 'active'
  RETURNING enrollment.id, enrollment.prospect_id
)
INSERT INTO "crm"."activities" (
  prospect_id, type, body, actor_type, actor_name, metadata
)
SELECT
  exited.prospect_id,
  'note',
  'Removed from cadence because this lead left Contacting.',
  'system',
  'System',
  jsonb_build_object(
    'source', 'cadence',
    'reason', 'left_contacting',
    'enrollmentId', exited.id
  )
FROM exited;--> statement-breakpoint

CREATE OR REPLACE FUNCTION crm.exit_cadence_outside_contacting()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM crm.pipeline_stages stage
    WHERE stage.id = NEW.stage_id
      AND stage.pipeline = 'prospect'
      AND stage.key <> 'cold'
  ) THEN
    RETURN NEW;
  END IF;

  WITH leaving AS (
    SELECT enrollment.id, enrollment.prospect_id
    FROM crm.cadence_enrollments enrollment
    WHERE enrollment.prospect_id = NEW.id
      AND enrollment.status = 'active'
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
        exited_reason = 'left_contacting',
        updated_at = now()
    FROM leaving
    WHERE enrollment.id = leaving.id
      AND enrollment.status = 'active'
    RETURNING enrollment.id, enrollment.prospect_id
  )
  INSERT INTO crm.activities (
    prospect_id, type, body, actor_type, actor_name, metadata
  )
  SELECT
    exited.prospect_id,
    'note',
    'Removed from cadence because this lead left Contacting.',
    'system',
    'System',
    jsonb_build_object(
      'source', 'cadence',
      'reason', 'left_contacting',
      'enrollmentId', exited.id
    )
  FROM exited;

  RETURN NEW;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS prospects_exit_cadence_outside_contacting ON crm.prospects;--> statement-breakpoint
CREATE TRIGGER prospects_exit_cadence_outside_contacting
AFTER UPDATE OF stage_id ON crm.prospects
FOR EACH ROW
WHEN (OLD.stage_id IS DISTINCT FROM NEW.stage_id)
EXECUTE FUNCTION crm.exit_cadence_outside_contacting();
