ALTER TABLE "crm"."google_connections"
  ADD COLUMN IF NOT EXISTS "google_refresh_token_ciphertext" text,
  ADD COLUMN IF NOT EXISTS "google_access_token_ciphertext" text,
  ADD COLUMN IF NOT EXISTS "google_access_token_expires_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "google_granted_scopes" text;--> statement-breakpoint
