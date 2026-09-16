CREATE TABLE "crm"."person_organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm"."person_organizations" ADD CONSTRAINT "person_organizations_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "crm"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."person_organizations" ADD CONSTRAINT "person_organizations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "crm"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "person_organizations_person_org_uidx" ON "crm"."person_organizations" USING btree ("person_id","organization_id");--> statement-breakpoint
CREATE INDEX "person_organizations_org_idx" ON "crm"."person_organizations" USING btree ("organization_id");--> statement-breakpoint
INSERT INTO "crm"."person_organizations" ("person_id", "organization_id")
SELECT "id", "organization_id" FROM "crm"."people"
WHERE "organization_id" IS NOT NULL
ON CONFLICT ("person_id", "organization_id") DO NOTHING;
