ALTER TYPE "crm"."user_role" ADD VALUE 'member';--> statement-breakpoint
CREATE TYPE "crm"."membership_org_role" AS ENUM('org_admin', 'org_user');--> statement-breakpoint
CREATE TABLE "crm"."user_organization_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"org_role" "crm"."membership_org_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm"."user_organization_memberships" ADD CONSTRAINT "user_organization_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "crm"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."user_organization_memberships" ADD CONSTRAINT "user_organization_memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "crm"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_organization_memberships_user_org_uidx" ON "crm"."user_organization_memberships" USING btree ("user_id","organization_id");--> statement-breakpoint
CREATE INDEX "user_organization_memberships_org_idx" ON "crm"."user_organization_memberships" USING btree ("organization_id");
