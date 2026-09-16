CREATE TYPE "crm"."prep_item_status" AS ENUM('pending', 'complete', 'not_applicable');--> statement-breakpoint
CREATE TABLE "crm"."booking_prep_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"status" "crm"."prep_item_status" DEFAULT 'pending' NOT NULL,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm"."course_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurrence_id" uuid NOT NULL,
	"name" text NOT NULL,
	"hardware_point_name" text,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm"."crew_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurrence_id" uuid NOT NULL,
	"person_id" uuid,
	"freeform_name" text,
	"role" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crew_assignments_name_check" CHECK ("crm"."crew_assignments"."person_id" IS NOT NULL OR NULLIF(trim("crm"."crew_assignments"."freeform_name"), '') IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "crm"."occurrence_races" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurrence_id" uuid NOT NULL,
	"catalog_race_offering_id" text,
	"name" text NOT NULL,
	"distance_label" text,
	"distance_miles" numeric(8, 3),
	"distance_meters" integer,
	"start_time" timestamp,
	"age_groups" text,
	"awards" text,
	"estimated_duration_minutes" integer,
	"duration_override_minutes" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "occurrence_races_duration_positive_check" CHECK (("crm"."occurrence_races"."estimated_duration_minutes" IS NULL OR "crm"."occurrence_races"."estimated_duration_minutes" > 0)
        AND ("crm"."occurrence_races"."duration_override_minutes" IS NULL OR "crm"."occurrence_races"."duration_override_minutes" > 0))
);
--> statement-breakpoint
ALTER TABLE "crm"."booking_prep_items" ADD CONSTRAINT "booking_prep_items_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "crm"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."booking_prep_items" ADD CONSTRAINT "booking_prep_items_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "crm"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."course_points" ADD CONSTRAINT "course_points_occurrence_id_event_occurrences_id_fk" FOREIGN KEY ("occurrence_id") REFERENCES "crm"."event_occurrences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."crew_assignments" ADD CONSTRAINT "crew_assignments_occurrence_id_event_occurrences_id_fk" FOREIGN KEY ("occurrence_id") REFERENCES "crm"."event_occurrences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."crew_assignments" ADD CONSTRAINT "crew_assignments_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "crm"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."occurrence_races" ADD CONSTRAINT "occurrence_races_occurrence_id_event_occurrences_id_fk" FOREIGN KEY ("occurrence_id") REFERENCES "crm"."event_occurrences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_prep_items_booking_key_uidx" ON "crm"."booking_prep_items" USING btree ("booking_id","key");--> statement-breakpoint
CREATE INDEX "booking_prep_items_booking_status_idx" ON "crm"."booking_prep_items" USING btree ("booking_id","status");--> statement-breakpoint
CREATE INDEX "course_points_occurrence_sort_idx" ON "crm"."course_points" USING btree ("occurrence_id","sort_order");--> statement-breakpoint
CREATE INDEX "crew_assignments_occurrence_idx" ON "crm"."crew_assignments" USING btree ("occurrence_id");--> statement-breakpoint
CREATE INDEX "occurrence_races_occurrence_sort_idx" ON "crm"."occurrence_races" USING btree ("occurrence_id","sort_order");
--> statement-breakpoint
INSERT INTO "crm"."booking_prep_items" ("booking_id", "key", "label")
SELECT booking.id, item.key, item.label
FROM "crm"."bookings" booking
CROSS JOIN (
  VALUES ('crew_email_sent', 'Crew email sent'), ('race_built', 'Race built')
) AS item(key, label)
ON CONFLICT ("booking_id", "key") DO NOTHING;