ALTER TABLE "crm"."occurrence_races"
  ADD COLUMN IF NOT EXISTS "scoring" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
DROP TRIGGER IF EXISTS google_calendar_needs_sync_races ON crm.occurrence_races;--> statement-breakpoint
CREATE TRIGGER google_calendar_needs_sync_races
AFTER INSERT OR UPDATE OF name, distance_label, start_time, age_groups, awards, scoring
OR DELETE ON crm.occurrence_races
FOR EACH ROW
EXECUTE FUNCTION crm.flag_google_calendar_needs_sync();
