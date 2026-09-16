ALTER TABLE "crm"."google_connections"
  ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint

ALTER TABLE "crm"."google_connections"
  DROP CONSTRAINT "google_connections_pkey";--> statement-breakpoint

ALTER TABLE "crm"."google_connections"
  ADD CONSTRAINT "google_connections_pkey" PRIMARY KEY ("id");--> statement-breakpoint

CREATE UNIQUE INDEX "google_connections_user_google_sub_uidx"
  ON "crm"."google_connections" ("user_id", "google_sub");
