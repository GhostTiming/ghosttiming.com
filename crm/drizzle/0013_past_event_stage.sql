INSERT INTO crm.pipeline_stages
  ("pipeline", "key", "name", "sort_order", "is_terminal", "is_active")
VALUES
  ('prospect', 'past_event', 'Past events', 80, true, true)
ON CONFLICT ("pipeline", "key") DO UPDATE SET
  name = EXCLUDED.name,
  sort_order = EXCLUDED.sort_order,
  is_terminal = EXCLUDED.is_terminal,
  is_active = EXCLUDED.is_active,
  updated_at = now();
