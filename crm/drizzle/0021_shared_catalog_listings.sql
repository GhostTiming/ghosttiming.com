DROP INDEX IF EXISTS "crm"."events_catalog_listing_uidx";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_catalog_listing_idx" ON "crm"."events" USING btree ("catalog_race_listing_id");--> statement-breakpoint
DROP INDEX IF EXISTS "crm"."event_occurrences_catalog_edition_uidx";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_occurrences_catalog_edition_idx" ON "crm"."event_occurrences" USING btree ("catalog_race_edition_id");
