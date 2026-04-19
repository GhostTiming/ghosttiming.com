CREATE TABLE "creation_ip_hour" (
	"ip_hash" text NOT NULL,
	"hour_bucket" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "creation_ip_hour_ip_hash_hour_bucket_pk" PRIMARY KEY("ip_hash","hour_bucket")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"short_id" text NOT NULL,
	"name" text DEFAULT 'Untitled event' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"pinned_at" timestamp with time zone,
	"ingest_token_hash" text NOT NULL,
	"viewer_password_hash" text NOT NULL,
	"last_ingest_at" timestamp with time zone,
	CONSTRAINT "events_short_id_unique" UNIQUE("short_id")
);
--> statement-breakpoint
CREATE TABLE "macs_event" (
	"event_id" uuid NOT NULL,
	"mac" text NOT NULL,
	"friendly_name" text,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"total_reads" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "macs_event_event_id_mac_pk" PRIMARY KEY("event_id","mac")
);
--> statement-breakpoint
CREATE TABLE "ports_event" (
	"event_id" uuid NOT NULL,
	"mac" text NOT NULL,
	"port" integer NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"total_reads" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "ports_event_event_id_mac_port_pk" PRIMARY KEY("event_id","mac","port")
);
--> statement-breakpoint
CREATE TABLE "reads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"mac" text NOT NULL,
	"port" integer NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"client_seq" bigint
);
--> statement-breakpoint
CREATE TABLE "timer_workspaces" (
	"event_id" uuid NOT NULL,
	"workspace_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timer_workspaces_event_id_workspace_id_pk" PRIMARY KEY("event_id","workspace_id")
);
--> statement-breakpoint
ALTER TABLE "macs_event" ADD CONSTRAINT "macs_event_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ports_event" ADD CONSTRAINT "ports_event_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reads" ADD CONSTRAINT "reads_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timer_workspaces" ADD CONSTRAINT "timer_workspaces_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_short_id_idx" ON "events" USING btree ("short_id");--> statement-breakpoint
CREATE INDEX "macs_event_last_seen_idx" ON "macs_event" USING btree ("event_id","last_seen");--> statement-breakpoint
CREATE INDEX "reads_event_ts_idx" ON "reads" USING btree ("event_id","ts" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reads_event_mac_ts_idx" ON "reads" USING btree ("event_id","mac","ts" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reads_event_mac_port_ts_idx" ON "reads" USING btree ("event_id","mac","port","ts" DESC NULLS LAST);