CREATE TYPE "crm"."contact_extraction_status" AS ENUM('processed', 'failed');--> statement-breakpoint
CREATE TABLE "crm"."contact_extraction_state" (
	"race_listing_id" text PRIMARY KEY NOT NULL,
	"source_content_hash" text NOT NULL,
	"parser_version" text NOT NULL,
	"status" "crm"."contact_extraction_status" NOT NULL,
	"extracted_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm"."contact_methods" DROP CONSTRAINT "contact_methods_prospect_id_prospects_id_fk";
--> statement-breakpoint
DROP INDEX "crm"."contact_methods_prospect_type_value_uidx";--> statement-breakpoint
DROP INDEX "crm"."contact_methods_prospect_primary_idx";--> statement-breakpoint
ALTER TABLE "crm"."contact_methods" ALTER COLUMN "prospect_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "crm"."contact_methods" ALTER COLUMN "race_listing_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "crm"."contact_extraction_state" ADD CONSTRAINT "contact_extraction_state_race_listing_id_race_listings_id_fk" FOREIGN KEY ("race_listing_id") REFERENCES "catalog"."race_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_extraction_state_updated_idx" ON "crm"."contact_extraction_state" USING btree ("updated_at");--> statement-breakpoint
ALTER TABLE "crm"."contact_methods" ADD CONSTRAINT "contact_methods_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "crm"."prospects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_methods_listing_type_value_uidx" ON "crm"."contact_methods" USING btree ("race_listing_id","type","normalized_value");--> statement-breakpoint
CREATE INDEX "contact_methods_listing_primary_idx" ON "crm"."contact_methods" USING btree ("race_listing_id","is_primary");--> statement-breakpoint
CREATE INDEX "contact_methods_prospect_idx" ON "crm"."contact_methods" USING btree ("prospect_id");