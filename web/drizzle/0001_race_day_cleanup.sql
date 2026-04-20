ALTER TABLE "events" ADD COLUMN "gate_time" text;
ALTER TABLE "events" DROP COLUMN "pinned_at";
ALTER TABLE "reads" DROP COLUMN "client_seq";
CREATE INDEX IF NOT EXISTS "ports_event_last_seen_idx" ON "ports_event" USING btree ("event_id","last_seen");
