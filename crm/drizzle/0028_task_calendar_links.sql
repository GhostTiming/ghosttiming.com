CREATE TABLE IF NOT EXISTS "crm"."google_task_calendar_links" (
  "task_id" uuid PRIMARY KEY NOT NULL REFERENCES "crm"."tasks"("id") ON DELETE CASCADE,
  "google_sub" text NOT NULL,
  "google_email" text NOT NULL,
  "google_calendar_id" text NOT NULL,
  "google_event_id" text NOT NULL,
  "html_link" text,
  "sync_status" "crm"."google_calendar_sync_status" NOT NULL DEFAULT 'synced',
  "last_synced_at" timestamp with time zone,
  "last_error" text,
  "linked_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "google_task_calendar_links_event_uidx"
  ON "crm"."google_task_calendar_links" ("google_calendar_id", "google_event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "google_task_calendar_links_status_idx"
  ON "crm"."google_task_calendar_links" ("sync_status");
