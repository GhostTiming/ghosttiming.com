ALTER TABLE "crm"."prospects" DROP CONSTRAINT "prospects_converted_booking_id_bookings_id_fk";
--> statement-breakpoint
ALTER TABLE "crm"."contact_methods" ALTER COLUMN "race_listing_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "crm"."bookings" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "crm"."bookings" ADD COLUMN "archived_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "crm"."events" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "crm"."events" ADD COLUMN "archived_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "crm"."organizations" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "crm"."organizations" ADD COLUMN "archived_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "crm"."people" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "crm"."people" ADD COLUMN "archived_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "crm"."prospects" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "crm"."prospects" ADD COLUMN "archived_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "crm"."bookings" ADD CONSTRAINT "bookings_archived_by_user_id_users_id_fk" FOREIGN KEY ("archived_by_user_id") REFERENCES "crm"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."events" ADD CONSTRAINT "events_archived_by_user_id_users_id_fk" FOREIGN KEY ("archived_by_user_id") REFERENCES "crm"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."organizations" ADD CONSTRAINT "organizations_archived_by_user_id_users_id_fk" FOREIGN KEY ("archived_by_user_id") REFERENCES "crm"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."people" ADD CONSTRAINT "people_archived_by_user_id_users_id_fk" FOREIGN KEY ("archived_by_user_id") REFERENCES "crm"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."prospects" ADD CONSTRAINT "prospects_archived_by_user_id_users_id_fk" FOREIGN KEY ("archived_by_user_id") REFERENCES "crm"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."prospects" ADD CONSTRAINT "prospects_converted_booking_id_bookings_id_fk" FOREIGN KEY ("converted_booking_id") REFERENCES "crm"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_methods_prospect_type_value_uidx" ON "crm"."contact_methods" USING btree ("prospect_id","type","normalized_value");--> statement-breakpoint
ALTER TABLE "crm"."contact_methods" ADD CONSTRAINT "contact_methods_source_check" CHECK ("crm"."contact_methods"."race_listing_id" IS NOT NULL OR "crm"."contact_methods"."prospect_id" IS NOT NULL);
--> statement-breakpoint
INSERT INTO "crm"."events"
  ("name", "catalog_race_listing_id", "source_type", "website")
SELECT DISTINCT
  listing.name,
  prospect.race_listing_id,
  'other'::"crm"."event_source_type",
  COALESCE(listing.registration_url, listing.external_race_url)
FROM "crm"."prospects" prospect
JOIN "catalog"."race_listings" listing
  ON listing.id = prospect.race_listing_id
WHERE prospect.event_id IS NULL
ON CONFLICT ("catalog_race_listing_id") DO NOTHING;
--> statement-breakpoint
UPDATE "crm"."prospects" prospect
SET event_id = event.id
FROM "crm"."events" event
WHERE prospect.event_id IS NULL
  AND event.catalog_race_listing_id = prospect.race_listing_id;
--> statement-breakpoint
INSERT INTO "crm"."event_occurrences"
  ("event_id", "catalog_race_edition_id", "occurrence_year", "race_date",
   "timezone", "registration_url_override")
SELECT
  prospect.event_id,
  prospect.race_edition_id,
  COALESCE(edition.edition_year,
    EXTRACT(YEAR FROM listing.next_start_at)::integer),
  COALESCE(edition.starts_at, listing.next_start_at),
  COALESCE(edition.timezone, listing.timezone),
  COALESCE(listing.registration_url, listing.external_race_url)
FROM "crm"."prospects" prospect
JOIN "catalog"."race_listings" listing
  ON listing.id = prospect.race_listing_id
LEFT JOIN "catalog"."race_editions" edition
  ON edition.id = prospect.race_edition_id
WHERE prospect.occurrence_id IS NULL
  AND prospect.race_edition_id IS NOT NULL
ON CONFLICT ("catalog_race_edition_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "crm"."event_occurrences"
  ("event_id", "occurrence_year", "race_date", "timezone",
   "registration_url_override")
SELECT
  prospect.event_id,
  EXTRACT(YEAR FROM listing.next_start_at)::integer,
  listing.next_start_at,
  listing.timezone,
  COALESCE(listing.registration_url, listing.external_race_url)
FROM "crm"."prospects" prospect
JOIN "catalog"."race_listings" listing
  ON listing.id = prospect.race_listing_id
WHERE prospect.occurrence_id IS NULL
  AND prospect.race_edition_id IS NULL
ON CONFLICT ("event_id", "occurrence_year") DO NOTHING;
--> statement-breakpoint
UPDATE "crm"."prospects" prospect
SET occurrence_id = occurrence.id
FROM "crm"."event_occurrences" occurrence
WHERE prospect.occurrence_id IS NULL
  AND occurrence.event_id = prospect.event_id
  AND (
    occurrence.catalog_race_edition_id = prospect.race_edition_id
    OR (
      prospect.race_edition_id IS NULL
      AND occurrence.occurrence_year = (
        SELECT EXTRACT(YEAR FROM listing.next_start_at)::integer
        FROM "catalog"."race_listings" listing
        WHERE listing.id = prospect.race_listing_id
      )
    )
  );