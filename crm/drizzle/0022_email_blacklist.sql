ALTER TABLE "crm"."prospects" DROP CONSTRAINT IF EXISTS "prospects_disqualified_reason_check";--> statement-breakpoint
ALTER TABLE "crm"."prospects" ADD CONSTRAINT "prospects_disqualified_reason_check"
  CHECK (
    "disqualified_reason" IS NULL
    OR "disqualified_reason" IN (
      'is_a_timing_company',
      'blacklisted_email',
      'other'
    )
  );--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "crm"."prospect_email_blacklist" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "pattern" text NOT NULL,
  "match_kind" text NOT NULL,
  "reason" text NOT NULL,
  "note" text,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "prospect_email_blacklist_match_kind_check"
    CHECK ("match_kind" IN ('email', 'domain')),
  CONSTRAINT "prospect_email_blacklist_reason_check"
    CHECK ("reason" IN ('is_a_timing_company', 'blacklisted_email', 'other'))
);--> statement-breakpoint
ALTER TABLE "crm"."prospect_email_blacklist" ADD CONSTRAINT "prospect_email_blacklist_created_by_users_id_fk"
  FOREIGN KEY ("created_by_user_id") REFERENCES "crm"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "prospect_email_blacklist_pattern_uidx"
  ON "crm"."prospect_email_blacklist" USING btree ("pattern");
