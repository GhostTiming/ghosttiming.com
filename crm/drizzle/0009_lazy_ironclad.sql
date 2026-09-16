DROP INDEX "crm"."event_occurrences_event_year_uidx";--> statement-breakpoint
CREATE INDEX "event_occurrences_event_year_idx" ON "crm"."event_occurrences" USING btree ("event_id","occurrence_year");