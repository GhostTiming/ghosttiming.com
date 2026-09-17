ALTER TABLE "crm"."users"
  ADD COLUMN IF NOT EXISTS "first_name" text,
  ADD COLUMN IF NOT EXISTS "last_name" text,
  ADD COLUMN IF NOT EXISTS "phone" text,
  ADD COLUMN IF NOT EXISTS "default_send_google_sub" text,
  ADD COLUMN IF NOT EXISTS "default_calendar_google_sub" text;--> statement-breakpoint
UPDATE "crm"."users"
SET
  "first_name" = COALESCE(
    "first_name",
    NULLIF(btrim(split_part("name", ' ', 1)), '')
  ),
  "last_name" = COALESCE(
    "last_name",
    CASE
      WHEN position(' ' in "name") > 0
        THEN NULLIF(btrim(substring("name" from position(' ' in "name") + 1)), '')
      ELSE NULL
    END
  )
WHERE "first_name" IS NULL AND "last_name" IS NULL;--> statement-breakpoint
UPDATE "crm"."users" AS u
SET
  "default_send_google_sub" = COALESCE(u."default_send_google_sub", c.google_sub),
  "default_calendar_google_sub" = COALESCE(u."default_calendar_google_sub", c.google_sub)
FROM (
  SELECT DISTINCT ON (user_id) user_id, google_sub
  FROM "crm"."google_connections"
  WHERE google_refresh_token_ciphertext IS NOT NULL
     OR gmail_status <> 'disconnected'
     OR calendar_status <> 'disconnected'
  ORDER BY user_id, connected_at ASC
) AS c
WHERE c.user_id = u.id
  AND (u."default_send_google_sub" IS NULL OR u."default_calendar_google_sub" IS NULL);