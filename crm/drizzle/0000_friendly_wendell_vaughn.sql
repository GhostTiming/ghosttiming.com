CREATE SCHEMA IF NOT EXISTS "crm";
--> statement-breakpoint
CREATE TYPE "crm"."activity_type" AS ENUM('phone_call', 'email', 'meeting', 'note', 'stage_change');--> statement-breakpoint
CREATE TYPE "crm"."actor_type" AS ENUM('human', 'ai', 'system');--> statement-breakpoint
CREATE TYPE "crm"."contact_method_source" AS ENUM('extracted', 'manual', 'ai', 'imported');--> statement-breakpoint
CREATE TYPE "crm"."contact_method_status" AS ENUM('valid', 'invalid', 'unknown');--> statement-breakpoint
CREATE TYPE "crm"."contact_method_type" AS ENUM('email', 'phone');--> statement-breakpoint
CREATE TYPE "crm"."pipeline_kind" AS ENUM('prospect', 'booking');--> statement-breakpoint
CREATE TYPE "crm"."task_status" AS ENUM('open', 'complete', 'canceled');--> statement-breakpoint
CREATE TYPE "crm"."user_role" AS ENUM('admin', 'prospecting_user');--> statement-breakpoint
CREATE TABLE "crm"."activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prospect_id" uuid NOT NULL,
	"type" "crm"."activity_type" NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"body" text NOT NULL,
	"disposition" text,
	"actor_type" "crm"."actor_type" NOT NULL,
	"actor_user_id" uuid,
	"actor_name" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activities_human_actor_check" CHECK ("crm"."activities"."actor_type" <> 'human' OR "crm"."activities"."actor_user_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "crm"."contact_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prospect_id" uuid NOT NULL,
	"race_listing_id" text,
	"type" "crm"."contact_method_type" NOT NULL,
	"raw_value" text NOT NULL,
	"normalized_value" text NOT NULL,
	"label" text,
	"source" "crm"."contact_method_source" NOT NULL,
	"source_field" text,
	"source_content_hash" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"status" "crm"."contact_method_status" DEFAULT 'unknown' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm"."pipeline_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pipeline" "crm"."pipeline_kind" NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer NOT NULL,
	"is_terminal" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm"."prospects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"race_listing_id" text NOT NULL,
	"race_edition_id" text,
	"assigned_user_id" uuid,
	"stage_id" uuid NOT NULL,
	"do_not_contact" boolean DEFAULT false NOT NULL,
	"closed_at" timestamp with time zone,
	"converted_booking_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm"."tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prospect_id" uuid NOT NULL,
	"source_activity_id" uuid,
	"assigned_user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"due_at" timestamp with time zone NOT NULL,
	"status" "crm"."task_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_completed_at_check" CHECK ("crm"."tasks"."status" <> 'complete' OR "crm"."tasks"."completed_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "crm"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_provider_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role" "crm"."user_role" DEFAULT 'prospecting_user' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_auth_provider_id_unique" UNIQUE("auth_provider_id")
);
--> statement-breakpoint
ALTER TABLE "crm"."activities" ADD CONSTRAINT "activities_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "crm"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."activities" ADD CONSTRAINT "activities_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "crm"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."contact_methods" ADD CONSTRAINT "contact_methods_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "crm"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."contact_methods" ADD CONSTRAINT "contact_methods_race_listing_id_race_listings_id_fk" FOREIGN KEY ("race_listing_id") REFERENCES "catalog"."race_listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."prospects" ADD CONSTRAINT "prospects_race_listing_id_race_listings_id_fk" FOREIGN KEY ("race_listing_id") REFERENCES "catalog"."race_listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."prospects" ADD CONSTRAINT "prospects_race_edition_id_race_editions_id_fk" FOREIGN KEY ("race_edition_id") REFERENCES "catalog"."race_editions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."prospects" ADD CONSTRAINT "prospects_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "crm"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."prospects" ADD CONSTRAINT "prospects_stage_id_pipeline_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "crm"."pipeline_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."tasks" ADD CONSTRAINT "tasks_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "crm"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."tasks" ADD CONSTRAINT "tasks_source_activity_id_activities_id_fk" FOREIGN KEY ("source_activity_id") REFERENCES "crm"."activities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm"."tasks" ADD CONSTRAINT "tasks_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "crm"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_prospect_occurred_idx" ON "crm"."activities" USING btree ("prospect_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_methods_prospect_type_value_uidx" ON "crm"."contact_methods" USING btree ("prospect_id","type","normalized_value");--> statement-breakpoint
CREATE INDEX "contact_methods_prospect_primary_idx" ON "crm"."contact_methods" USING btree ("prospect_id","is_primary");--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_stages_pipeline_key_uidx" ON "crm"."pipeline_stages" USING btree ("pipeline","key");--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_stages_pipeline_sort_uidx" ON "crm"."pipeline_stages" USING btree ("pipeline","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "prospects_source_uidx" ON "crm"."prospects" USING btree ("race_listing_id",coalesce("race_edition_id", ''));--> statement-breakpoint
CREATE INDEX "prospects_stage_idx" ON "crm"."prospects" USING btree ("stage_id");--> statement-breakpoint
CREATE INDEX "prospects_assignee_idx" ON "crm"."prospects" USING btree ("assigned_user_id");--> statement-breakpoint
CREATE INDEX "prospects_created_at_idx" ON "crm"."prospects" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "tasks_assignee_status_due_idx" ON "crm"."tasks" USING btree ("assigned_user_id","status","due_at");--> statement-breakpoint
CREATE INDEX "tasks_prospect_status_due_idx" ON "crm"."tasks" USING btree ("prospect_id","status","due_at");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "crm"."users" USING btree ("email");--> statement-breakpoint

INSERT INTO "crm"."pipeline_stages"
  ("pipeline", "key", "name", "sort_order", "is_terminal")
VALUES
  ('prospect', 'cold', 'Cold', 10, false),
  ('prospect', 'interested', 'Interested', 20, false),
  ('prospect', 'scoping', 'Scoping', 30, false),
  ('prospect', 'confirmed', 'Confirmed', 40, true),
  ('prospect', 'closed_lost', 'Closed Lost', 50, true)
ON CONFLICT ("pipeline", "key") DO NOTHING;--> statement-breakpoint

CREATE VIEW "crm"."prospect_work_queue" AS
SELECT
  p.id AS prospect_id,
  p.race_listing_id,
  p.race_edition_id,
  p.assigned_user_id,
  ps.key AS stage_key,
  ps.name AS stage_name,
  p.do_not_contact,
  p.closed_at,
  p.converted_booking_id,
  COALESCE(touches.touch_count, 0)::integer AS touch_count,
  touches.last_touch_at,
  last_activity.disposition AS last_disposition,
  last_activity.body AS last_step,
  last_activity.occurred_at AS last_step_at,
  next_task.id AS next_task_id,
  next_task.title AS next_step,
  next_task.due_at AS next_step_at,
  p.created_at,
  p.updated_at
FROM "crm"."prospects" p
JOIN "crm"."pipeline_stages" ps ON ps.id = p.stage_id
LEFT JOIN LATERAL (
  SELECT
    count(*) FILTER (WHERE a.type IN ('phone_call', 'email', 'meeting')) AS touch_count,
    max(a.occurred_at) FILTER (WHERE a.type IN ('phone_call', 'email', 'meeting')) AS last_touch_at
  FROM "crm"."activities" a
  WHERE a.prospect_id = p.id
) touches ON true
LEFT JOIN LATERAL (
  SELECT a.body, a.disposition, a.occurred_at
  FROM "crm"."activities" a
  WHERE a.prospect_id = p.id AND a.type <> 'stage_change'
  ORDER BY a.occurred_at DESC, a.created_at DESC
  LIMIT 1
) last_activity ON true
LEFT JOIN LATERAL (
  SELECT t.id, t.title, t.due_at
  FROM "crm"."tasks" t
  WHERE t.prospect_id = p.id AND t.status = 'open'
  ORDER BY t.due_at ASC
  LIMIT 1
) next_task ON true;