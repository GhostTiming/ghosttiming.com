CREATE TABLE IF NOT EXISTS "crm"."email_drafts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "prospect_id" uuid NOT NULL,
  "created_by_user_id" uuid,
  "gmail_thread_id" text,
  "in_reply_to_rfc_message_id" text,
  "reply_to_gmail_message_id" text,
  "to_addresses" text[] DEFAULT '{}' NOT NULL,
  "cc_addresses" text[] DEFAULT '{}' NOT NULL,
  "subject" text DEFAULT '' NOT NULL,
  "body_text" text DEFAULT '' NOT NULL,
  "sent_at" timestamp with time zone,
  "sent_gmail_message_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "crm"."email_drafts" ADD CONSTRAINT "email_drafts_prospect_id_prospects_id_fk"
  FOREIGN KEY ("prospect_id") REFERENCES "crm"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."email_drafts" ADD CONSTRAINT "email_drafts_created_by_user_id_users_id_fk"
  FOREIGN KEY ("created_by_user_id") REFERENCES "crm"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_drafts_prospect_idx"
  ON "crm"."email_drafts" USING btree ("prospect_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_drafts_author_idx"
  ON "crm"."email_drafts" USING btree ("created_by_user_id");
