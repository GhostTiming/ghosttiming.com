CREATE TYPE "crm"."google_connection_status" AS ENUM(
  'disconnected',
  'connected',
  'syncing',
  'synced',
  'expired',
  'error'
);--> statement-breakpoint

CREATE TYPE "crm"."google_calendar_sync_status" AS ENUM(
  'synced',
  'needs_sync',
  'error',
  'deleted'
);--> statement-breakpoint

CREATE TYPE "crm"."google_email_direction" AS ENUM('incoming', 'outgoing');--> statement-breakpoint

CREATE TABLE "crm"."google_connections" (
  "user_id" uuid PRIMARY KEY REFERENCES "crm"."users"("id") ON DELETE CASCADE,
  "google_sub" text NOT NULL,
  "google_email" text NOT NULL,
  "gmail_history_id" text,
  "gmail_last_synced_at" timestamp with time zone,
  "gmail_backfill_completed_at" timestamp with time zone,
  "gmail_status" "crm"."google_connection_status" NOT NULL DEFAULT 'disconnected',
  "gmail_last_error" text,
  "calendar_id" text,
  "calendar_summary" text,
  "calendar_status" "crm"."google_connection_status" NOT NULL DEFAULT 'disconnected',
  "calendar_last_error" text,
  "calendar_last_synced_at" timestamp with time zone,
  "connected_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE UNIQUE INDEX "google_connections_google_sub_uidx"
  ON "crm"."google_connections" ("google_sub");--> statement-breakpoint

CREATE TABLE "crm"."google_email_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "google_sub" text NOT NULL,
  "google_email" text NOT NULL,
  "gmail_message_id" text NOT NULL,
  "gmail_thread_id" text,
  "rfc_message_id" text,
  "direction" "crm"."google_email_direction" NOT NULL,
  "from_address" text,
  "from_name" text,
  "to_addresses" text[] NOT NULL DEFAULT '{}',
  "cc_addresses" text[] NOT NULL DEFAULT '{}',
  "subject" text,
  "snippet" text,
  "body_text" text,
  "occurred_at" timestamp with time zone NOT NULL,
  "synced_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE UNIQUE INDEX "google_email_messages_account_id_uidx"
  ON "crm"."google_email_messages" ("google_sub", "gmail_message_id");--> statement-breakpoint

CREATE INDEX "google_email_messages_occurred_idx"
  ON "crm"."google_email_messages" ("occurred_at");--> statement-breakpoint

CREATE TABLE "crm"."google_email_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "message_id" uuid NOT NULL REFERENCES "crm"."google_email_messages"("id") ON DELETE CASCADE,
  "prospect_id" uuid REFERENCES "crm"."prospects"("id") ON DELETE CASCADE,
  "booking_id" uuid REFERENCES "crm"."bookings"("id") ON DELETE CASCADE,
  "organization_id" uuid REFERENCES "crm"."organizations"("id") ON DELETE CASCADE,
  "person_id" uuid REFERENCES "crm"."people"("id") ON DELETE SET NULL,
  "activity_id" uuid REFERENCES "crm"."activities"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "google_email_links_record_check" CHECK (
    "prospect_id" IS NOT NULL
    OR "booking_id" IS NOT NULL
    OR "organization_id" IS NOT NULL
    OR "person_id" IS NOT NULL
  )
);--> statement-breakpoint

CREATE UNIQUE INDEX "google_email_links_message_prospect_uidx"
  ON "crm"."google_email_links" ("message_id", "prospect_id")
  WHERE "prospect_id" IS NOT NULL;--> statement-breakpoint

CREATE UNIQUE INDEX "google_email_links_message_booking_uidx"
  ON "crm"."google_email_links" ("message_id", "booking_id")
  WHERE "booking_id" IS NOT NULL;--> statement-breakpoint

CREATE UNIQUE INDEX "google_email_links_message_organization_uidx"
  ON "crm"."google_email_links" ("message_id", "organization_id")
  WHERE "organization_id" IS NOT NULL;--> statement-breakpoint

CREATE UNIQUE INDEX "google_email_links_message_person_uidx"
  ON "crm"."google_email_links" ("message_id", "person_id")
  WHERE "person_id" IS NOT NULL;--> statement-breakpoint

CREATE INDEX "google_email_links_activity_idx"
  ON "crm"."google_email_links" ("activity_id");--> statement-breakpoint

CREATE UNIQUE INDEX "google_email_activity_prospect_uidx"
  ON "crm"."activities" ((metadata->>'gmailMessageId'), "prospect_id")
  WHERE metadata->>'source' = 'gmail' AND "prospect_id" IS NOT NULL;--> statement-breakpoint

CREATE UNIQUE INDEX "google_email_activity_booking_uidx"
  ON "crm"."activities" ((metadata->>'gmailMessageId'), "booking_id")
  WHERE metadata->>'source' = 'gmail' AND "booking_id" IS NOT NULL;--> statement-breakpoint

CREATE UNIQUE INDEX "google_email_activity_organization_uidx"
  ON "crm"."activities" ((metadata->>'gmailMessageId'), "organization_id")
  WHERE metadata->>'source' = 'gmail' AND "organization_id" IS NOT NULL;--> statement-breakpoint

CREATE TABLE "crm"."google_calendar_links" (
  "booking_id" uuid PRIMARY KEY REFERENCES "crm"."bookings"("id") ON DELETE CASCADE,
  "google_sub" text NOT NULL,
  "google_email" text NOT NULL,
  "google_calendar_id" text NOT NULL,
  "google_event_id" text NOT NULL,
  "html_link" text,
  "sync_status" "crm"."google_calendar_sync_status" NOT NULL DEFAULT 'synced',
  "last_synced_at" timestamp with time zone,
  "last_error" text,
  "linked_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE UNIQUE INDEX "google_calendar_links_event_uidx"
  ON "crm"."google_calendar_links" ("google_calendar_id", "google_event_id");--> statement-breakpoint

CREATE INDEX "google_calendar_links_status_idx"
  ON "crm"."google_calendar_links" ("sync_status");--> statement-breakpoint

CREATE OR REPLACE FUNCTION crm.flag_google_calendar_needs_sync()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_occurrence_id uuid;
  target_event_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'event_occurrences' THEN
    target_occurrence_id := COALESCE(NEW.id, OLD.id);
  ELSIF TG_TABLE_NAME IN ('occurrence_races', 'crew_assignments') THEN
    target_occurrence_id := COALESCE(NEW.occurrence_id, OLD.occurrence_id);
  ELSIF TG_TABLE_NAME = 'events' THEN
    target_event_id := COALESCE(NEW.id, OLD.id);
  END IF;

  UPDATE crm.google_calendar_links link
  SET sync_status = 'needs_sync',
      updated_at = now()
  FROM crm.bookings booking
  JOIN crm.event_occurrences occurrence ON occurrence.id = booking.occurrence_id
  WHERE link.booking_id = booking.id
    AND link.sync_status IN ('synced', 'error', 'needs_sync')
    AND (
      (target_occurrence_id IS NOT NULL AND occurrence.id = target_occurrence_id)
      OR (target_event_id IS NOT NULL AND occurrence.event_id = target_event_id)
    );

  RETURN NULL;
END;
$$;--> statement-breakpoint

CREATE TRIGGER google_calendar_needs_sync_events
AFTER UPDATE OF name, website ON crm.events
FOR EACH ROW
EXECUTE FUNCTION crm.flag_google_calendar_needs_sync();--> statement-breakpoint

CREATE TRIGGER google_calendar_needs_sync_occurrences
AFTER UPDATE OF race_date, timezone, registration_url_override, street_override,
  street2_override, city_override, state_override, zipcode_override,
  timer_location, calculated_arrival_at, arrival_override_at,
  calculated_departure_at, departure_override_at
ON crm.event_occurrences
FOR EACH ROW
EXECUTE FUNCTION crm.flag_google_calendar_needs_sync();--> statement-breakpoint

CREATE TRIGGER google_calendar_needs_sync_races
AFTER INSERT OR UPDATE OF name, distance_label, start_time, age_groups, awards
OR DELETE ON crm.occurrence_races
FOR EACH ROW
EXECUTE FUNCTION crm.flag_google_calendar_needs_sync();--> statement-breakpoint

CREATE TRIGGER google_calendar_needs_sync_crew
AFTER INSERT OR UPDATE OF person_id, freeform_name, role
OR DELETE ON crm.crew_assignments
FOR EACH ROW
EXECUTE FUNCTION crm.flag_google_calendar_needs_sync();
