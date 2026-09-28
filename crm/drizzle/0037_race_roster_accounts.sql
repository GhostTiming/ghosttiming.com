CREATE TABLE "crm"."race_roster_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "username" text NOT NULL,
  "display_name" text,
  "status" text DEFAULT 'connected' NOT NULL,
  "last_error" text,
  "access_token_ciphertext" text,
  "refresh_token_ciphertext" text,
  "access_token_expires_at" timestamp with time zone,
  "connected_by_user_id" uuid REFERENCES "crm"."users"("id") ON DELETE SET NULL,
  "connected_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "race_roster_accounts_status_check" CHECK ("status" IN ('connected', 'expired', 'disconnected')),
  CONSTRAINT "race_roster_accounts_username_key" UNIQUE ("username")
);--> statement-breakpoint

CREATE INDEX "race_roster_accounts_status_idx"
  ON "crm"."race_roster_accounts" ("status");
