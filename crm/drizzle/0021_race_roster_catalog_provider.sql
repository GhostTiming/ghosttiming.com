-- Allow Race Roster (and future providers) alongside RunSignUp without
-- colliding on shared integer source IDs.

ALTER TABLE "catalog"."race_listings"
  DROP CONSTRAINT IF EXISTS "race_listings_source_race_id_key";
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "race_listings_provider_source_race_id_uidx"
  ON "catalog"."race_listings" ("source_provider", "source_race_id");
--> statement-breakpoint

ALTER TABLE "catalog"."race_editions"
  ADD COLUMN IF NOT EXISTS "source_provider" text NOT NULL DEFAULT 'runsignup';
--> statement-breakpoint

DROP INDEX IF EXISTS "catalog"."race_editions_source_race_id_source_race_event_days_id_key";
--> statement-breakpoint

ALTER TABLE "catalog"."race_editions"
  DROP CONSTRAINT IF EXISTS "race_editions_source_race_id_source_race_event_days_id_edit_key";
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "race_editions_provider_days_uidx"
  ON "catalog"."race_editions" (
    "source_provider",
    "source_race_id",
    "source_race_event_days_id"
  );
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "race_editions_provider_days_year_uidx"
  ON "catalog"."race_editions" (
    "source_provider",
    "source_race_id",
    "source_race_event_days_id",
    "edition_year"
  );
--> statement-breakpoint

ALTER TABLE "catalog"."race_offerings"
  ADD COLUMN IF NOT EXISTS "source_provider" text NOT NULL DEFAULT 'runsignup';
--> statement-breakpoint

ALTER TABLE "catalog"."race_offerings"
  DROP CONSTRAINT IF EXISTS "race_offerings_source_event_id_key";
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "race_offerings_provider_race_event_uidx"
  ON "catalog"."race_offerings" (
    "source_provider",
    "source_race_id",
    "source_event_id"
  );
