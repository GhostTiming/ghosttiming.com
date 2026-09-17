CREATE TABLE IF NOT EXISTS "crm"."email_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "crm"."users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "subject" text NOT NULL DEFAULT '',
  "body_html" text NOT NULL DEFAULT '',
  "kind" text NOT NULL DEFAULT 'crew',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_templates_user_name_uidx"
  ON "crm"."email_templates" ("user_id", "name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_templates_user_idx"
  ON "crm"."email_templates" ("user_id");
