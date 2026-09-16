CREATE TABLE "crm"."external_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"entity_type" text NOT NULL,
	"external_id" text NOT NULL,
	"local_id" uuid NOT NULL,
	"raw_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm"."prospects" ALTER COLUMN "race_listing_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "crm"."people" ADD COLUMN "contact_type" text;--> statement-breakpoint
ALTER TABLE "crm"."people" ADD COLUMN "do_not_contact" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "crm"."people" ADD COLUMN "email_opt_out" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "crm"."prospects" ADD COLUMN "event_id" uuid;--> statement-breakpoint
ALTER TABLE "crm"."prospects" ADD COLUMN "occurrence_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "external_records_source_type_id_uidx" ON "crm"."external_records" USING btree ("source","entity_type","external_id");--> statement-breakpoint
CREATE INDEX "external_records_local_idx" ON "crm"."external_records" USING btree ("entity_type","local_id");--> statement-breakpoint
ALTER TABLE "crm"."prospects" ADD CONSTRAINT "prospects_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "crm"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."prospects" ADD CONSTRAINT "prospects_occurrence_id_event_occurrences_id_fk" FOREIGN KEY ("occurrence_id") REFERENCES "crm"."event_occurrences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prospects_occurrence_uidx" ON "crm"."prospects" USING btree ("occurrence_id");--> statement-breakpoint
ALTER TABLE "crm"."prospects" ADD CONSTRAINT "prospects_source_check" CHECK ("crm"."prospects"."race_listing_id" IS NOT NULL OR "crm"."prospects"."event_id" IS NOT NULL);