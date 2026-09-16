CREATE TYPE "crm"."event_source_type" AS ENUM('runsignup', 'race_roster', 'manual', 'other');--> statement-breakpoint
CREATE TYPE "crm"."organization_role" AS ENUM('direct_client', 'event_owner', 'timing_company', 'other');--> statement-breakpoint
CREATE TYPE "crm"."timer_location" AS ENUM('on_site', 'remote');--> statement-breakpoint
CREATE TABLE "crm"."bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurrence_id" uuid NOT NULL,
	"direct_client_organization_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"assigned_user_id" uuid,
	"expected_revenue" numeric(12, 2),
	"actual_revenue" numeric(12, 2),
	"amount_paid" numeric(12, 2) DEFAULT '0' NOT NULL,
	"completed_at" timestamp with time zone,
	"payment_due_at" timestamp with time zone,
	"payment_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm"."event_occurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"catalog_race_edition_id" text,
	"occurrence_year" integer,
	"race_date" timestamp with time zone,
	"timezone" text,
	"event_owner_organization_id" uuid,
	"registration_platform" text,
	"registration_url_override" text,
	"street_override" text,
	"street2_override" text,
	"city_override" text,
	"state_override" text,
	"zipcode_override" text,
	"timer_location" "crm"."timer_location",
	"hardware_event_name" text,
	"scoring_expectations" text,
	"post_event_expectations" text,
	"notes" text,
	"calculated_arrival_at" timestamp with time zone,
	"arrival_override_at" timestamp with time zone,
	"calculated_departure_at" timestamp with time zone,
	"departure_override_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm"."events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"catalog_race_listing_id" text,
	"source_type" "crm"."event_source_type" DEFAULT 'manual' NOT NULL,
	"external_source_id" text,
	"default_owner_organization_id" uuid,
	"website" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm"."organization_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_organization_id" uuid NOT NULL,
	"target_organization_id" uuid NOT NULL,
	"relationship_type" text DEFAULT 'client_of' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_relationships_not_self_check" CHECK ("crm"."organization_relationships"."source_organization_id" <> "crm"."organization_relationships"."target_organization_id")
);
--> statement-breakpoint
CREATE TABLE "crm"."organization_roles" (
	"organization_id" uuid NOT NULL,
	"role" "crm"."organization_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm"."organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"website" text,
	"phone" text,
	"email" text,
	"street" text,
	"street2" text,
	"city" text,
	"state" text,
	"zipcode" text,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm"."people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"first_name" text,
	"last_name" text,
	"display_name" text,
	"title" text,
	"email" text,
	"phone" text,
	"street" text,
	"street2" text,
	"city" text,
	"state" text,
	"zipcode" text,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm"."activities" ALTER COLUMN "prospect_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "crm"."tasks" ALTER COLUMN "prospect_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "crm"."activities" ADD COLUMN "booking_id" uuid;--> statement-breakpoint
ALTER TABLE "crm"."activities" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "crm"."tasks" ADD COLUMN "booking_id" uuid;--> statement-breakpoint
ALTER TABLE "crm"."tasks" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "crm"."bookings" ADD CONSTRAINT "bookings_occurrence_id_event_occurrences_id_fk" FOREIGN KEY ("occurrence_id") REFERENCES "crm"."event_occurrences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."bookings" ADD CONSTRAINT "bookings_direct_client_organization_id_organizations_id_fk" FOREIGN KEY ("direct_client_organization_id") REFERENCES "crm"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."bookings" ADD CONSTRAINT "bookings_stage_id_pipeline_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "crm"."pipeline_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."bookings" ADD CONSTRAINT "bookings_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "crm"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."event_occurrences" ADD CONSTRAINT "event_occurrences_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "crm"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."event_occurrences" ADD CONSTRAINT "event_occurrences_catalog_race_edition_id_race_editions_id_fk" FOREIGN KEY ("catalog_race_edition_id") REFERENCES "catalog"."race_editions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."event_occurrences" ADD CONSTRAINT "event_occurrences_event_owner_organization_id_organizations_id_fk" FOREIGN KEY ("event_owner_organization_id") REFERENCES "crm"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."events" ADD CONSTRAINT "events_catalog_race_listing_id_race_listings_id_fk" FOREIGN KEY ("catalog_race_listing_id") REFERENCES "catalog"."race_listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."events" ADD CONSTRAINT "events_default_owner_organization_id_organizations_id_fk" FOREIGN KEY ("default_owner_organization_id") REFERENCES "crm"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."organization_relationships" ADD CONSTRAINT "organization_relationships_source_organization_id_organizations_id_fk" FOREIGN KEY ("source_organization_id") REFERENCES "crm"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."organization_relationships" ADD CONSTRAINT "organization_relationships_target_organization_id_organizations_id_fk" FOREIGN KEY ("target_organization_id") REFERENCES "crm"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."organization_roles" ADD CONSTRAINT "organization_roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "crm"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."people" ADD CONSTRAINT "people_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "crm"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_occurrence_uidx" ON "crm"."bookings" USING btree ("occurrence_id");--> statement-breakpoint
CREATE INDEX "bookings_stage_idx" ON "crm"."bookings" USING btree ("stage_id");--> statement-breakpoint
CREATE INDEX "bookings_client_idx" ON "crm"."bookings" USING btree ("direct_client_organization_id");--> statement-breakpoint
CREATE INDEX "bookings_completed_idx" ON "crm"."bookings" USING btree ("completed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "event_occurrences_catalog_edition_uidx" ON "crm"."event_occurrences" USING btree ("catalog_race_edition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_occurrences_event_year_uidx" ON "crm"."event_occurrences" USING btree ("event_id","occurrence_year");--> statement-breakpoint
CREATE INDEX "event_occurrences_race_date_idx" ON "crm"."event_occurrences" USING btree ("race_date");--> statement-breakpoint
CREATE UNIQUE INDEX "events_catalog_listing_uidx" ON "crm"."events" USING btree ("catalog_race_listing_id");--> statement-breakpoint
CREATE INDEX "events_name_idx" ON "crm"."events" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_relationships_unique_uidx" ON "crm"."organization_relationships" USING btree ("source_organization_id","target_organization_id","relationship_type");--> statement-breakpoint
CREATE INDEX "organization_relationships_target_idx" ON "crm"."organization_relationships" USING btree ("target_organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_roles_org_role_uidx" ON "crm"."organization_roles" USING btree ("organization_id","role");--> statement-breakpoint
CREATE INDEX "organization_roles_role_idx" ON "crm"."organization_roles" USING btree ("role");--> statement-breakpoint
CREATE INDEX "organizations_name_idx" ON "crm"."organizations" USING btree ("name");--> statement-breakpoint
CREATE INDEX "organizations_active_idx" ON "crm"."organizations" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "people_organization_idx" ON "crm"."people" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "people_display_name_idx" ON "crm"."people" USING btree ("display_name");--> statement-breakpoint
ALTER TABLE "crm"."activities" ADD CONSTRAINT "activities_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "crm"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."activities" ADD CONSTRAINT "activities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "crm"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."tasks" ADD CONSTRAINT "tasks_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "crm"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."tasks" ADD CONSTRAINT "tasks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "crm"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_booking_occurred_idx" ON "crm"."activities" USING btree ("booking_id","occurred_at");--> statement-breakpoint
CREATE INDEX "activities_organization_occurred_idx" ON "crm"."activities" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "tasks_booking_status_due_idx" ON "crm"."tasks" USING btree ("booking_id","status","due_at");--> statement-breakpoint
ALTER TABLE "crm"."activities" ADD CONSTRAINT "activities_related_record_check" CHECK ("crm"."activities"."prospect_id" IS NOT NULL OR "crm"."activities"."booking_id" IS NOT NULL OR "crm"."activities"."organization_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "crm"."tasks" ADD CONSTRAINT "tasks_related_record_check" CHECK ("crm"."tasks"."prospect_id" IS NOT NULL OR "crm"."tasks"."booking_id" IS NOT NULL OR "crm"."tasks"."organization_id" IS NOT NULL);
--> statement-breakpoint
INSERT INTO "crm"."pipeline_stages"
  ("pipeline", "key", "name", "sort_order", "is_terminal")
VALUES
  ('booking', 'awaiting_decision', 'Awaiting Decision', 10, false),
  ('booking', 'confirmed', 'Confirmed', 20, false),
  ('booking', 'pre_event_prep', 'Pre-Event Prep', 30, false),
  ('booking', 'ready', 'Ready', 40, false),
  ('booking', 'completed', 'Completed', 50, false),
  ('booking', 'paid', 'Paid', 60, true),
  ('booking', 'closed_lost', 'Closed Lost', 70, true)
ON CONFLICT ("pipeline", "key") DO NOTHING;