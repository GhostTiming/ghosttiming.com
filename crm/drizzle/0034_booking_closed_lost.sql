ALTER TABLE "crm"."bookings" ADD COLUMN IF NOT EXISTS "closed_lost_reason" text;--> statement-breakpoint
ALTER TABLE "crm"."bookings" ADD COLUMN IF NOT EXISTS "closed_lost_note" text;--> statement-breakpoint
ALTER TABLE "crm"."bookings" ADD COLUMN IF NOT EXISTS "circle_back_on" date;--> statement-breakpoint
ALTER TABLE "crm"."bookings" DROP CONSTRAINT IF EXISTS "bookings_closed_lost_reason_check";--> statement-breakpoint
ALTER TABLE "crm"."bookings" ADD CONSTRAINT "bookings_closed_lost_reason_check"
  CHECK (
    "closed_lost_reason" IS NULL
    OR "closed_lost_reason" IN (
      'went_with_another_timer',
      'event_cancelled',
      'no_decision',
      'other'
    )
  );
