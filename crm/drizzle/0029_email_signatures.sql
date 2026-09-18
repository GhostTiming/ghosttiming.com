CREATE TABLE IF NOT EXISTS "crm"."email_signatures" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "crm"."users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "body_html" text NOT NULL DEFAULT '',
  "is_default" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_signatures_user_name_uidx"
  ON "crm"."email_signatures" ("user_id", "name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_signatures_user_default_uidx"
  ON "crm"."email_signatures" ("user_id")
  WHERE "is_default";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_signatures_user_idx"
  ON "crm"."email_signatures" ("user_id");
