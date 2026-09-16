ALTER TABLE "crm"."prospects" ADD COLUMN IF NOT EXISTS "last_step_note" text;--> statement-breakpoint
ALTER TABLE "crm"."prospects" ADD COLUMN IF NOT EXISTS "next_step_on" date;--> statement-breakpoint
ALTER TABLE "crm"."prospects" ADD COLUMN IF NOT EXISTS "next_step_note" text;--> statement-breakpoint
CREATE OR REPLACE VIEW "crm"."prospect_work_queue" AS
SELECT
  p.id AS prospect_id,
  p.race_listing_id,
  p.race_edition_id,
  p.assigned_user_id,
  ps.key AS stage_key,
  ps.name AS stage_name,
  p.do_not_contact,
  p.closed_at,
  p.converted_booking_id,
  COALESCE(touches.touch_count, 0)::integer AS touch_count,
  touches.last_touch_at,
  last_activity.disposition AS last_disposition,
  COALESCE(last_activity.metadata->>'eventType', last_activity.type::text) AS last_step,
  last_activity.occurred_at AS last_step_at,
  next_task.id AS next_task_id,
  next_task.title AS next_step,
  next_task.due_at AS next_step_at,
  p.created_at,
  p.updated_at
FROM "crm"."prospects" p
JOIN "crm"."pipeline_stages" ps ON ps.id = p.stage_id
LEFT JOIN LATERAL (
  SELECT
    count(*) FILTER (WHERE a.type IN ('phone_call', 'email', 'meeting')) AS touch_count,
    max(a.occurred_at) FILTER (WHERE a.type IN ('phone_call', 'email', 'meeting')) AS last_touch_at
  FROM "crm"."activities" a
  WHERE a.prospect_id = p.id
) touches ON true
LEFT JOIN LATERAL (
  SELECT a.body, a.disposition, a.occurred_at, a.type, a.metadata
  FROM "crm"."activities" a
  WHERE a.prospect_id = p.id AND a.type <> 'stage_change'
  ORDER BY a.occurred_at DESC, a.created_at DESC
  LIMIT 1
) last_activity ON true
LEFT JOIN LATERAL (
  SELECT t.id, t.title, t.due_at
  FROM "crm"."tasks" t
  WHERE t.prospect_id = p.id AND t.status = 'open'
  ORDER BY t.due_at ASC
  LIMIT 1
) next_task ON true;
