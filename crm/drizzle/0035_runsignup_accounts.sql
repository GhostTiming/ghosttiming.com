CREATE TABLE "crm"."runsignup_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "runsignup_user_id" text NOT NULL,
  "email" text,
  "display_name" text,
  "status" text DEFAULT 'connected' NOT NULL,
  "last_error" text,
  "access_token_ciphertext" text,
  "refresh_token_ciphertext" text,
  "access_token_expires_at" timestamp with time zone,
  "granted_scopes" text,
  "connected_by_user_id" uuid REFERENCES "crm"."users"("id") ON DELETE SET NULL,
  "connected_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "runsignup_accounts_status_check" CHECK ("status" IN ('connected', 'expired', 'disconnected')),
  CONSTRAINT "runsignup_accounts_user_id_key" UNIQUE ("runsignup_user_id")
);--> statement-breakpoint

CREATE INDEX "runsignup_accounts_status_idx"
  ON "crm"."runsignup_accounts" ("status");
