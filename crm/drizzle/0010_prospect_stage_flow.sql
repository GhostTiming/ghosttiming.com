UPDATE crm.prospects
SET stage_id = contacting.id, updated_at = now()
FROM crm.pipeline_stages AS interested
JOIN crm.pipeline_stages AS contacting
  ON contacting.pipeline = 'prospect' AND contacting.key = 'cold'
WHERE interested.pipeline = 'prospect'
  AND interested.key = 'interested'
  AND prospects.stage_id = interested.id;--> statement-breakpoint
UPDATE crm.pipeline_stages
SET name = 'Contacting', updated_at = now()
WHERE pipeline = 'prospect' AND key = 'cold';--> statement-breakpoint
UPDATE crm.pipeline_stages
SET is_active = false, updated_at = now()
WHERE pipeline = 'prospect' AND key = 'interested';
