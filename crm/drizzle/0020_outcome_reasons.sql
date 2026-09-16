ALTER TABLE "crm"."prospects" ADD COLUMN IF NOT EXISTS "unqualified_reason" text;--> statement-breakpoint
ALTER TABLE "crm"."prospects" ADD COLUMN IF NOT EXISTS "unqualified_note" text;--> statement-breakpoint
ALTER TABLE "crm"."prospects" ADD COLUMN IF NOT EXISTS "disqualified_reason" text;--> statement-breakpoint
ALTER TABLE "crm"."prospects" ADD COLUMN IF NOT EXISTS "disqualified_note" text;--> statement-breakpoint
ALTER TABLE "crm"."prospects" DROP CONSTRAINT IF EXISTS "prospects_unqualified_reason_check";--> statement-breakpoint
ALTER TABLE "crm"."prospects" ADD CONSTRAINT "prospects_unqualified_reason_check"
  CHECK (
    "unqualified_reason" IS NULL
    OR "unqualified_reason" IN (
      'event_too_soon',
      'other'
    )
  );--> statement-breakpoint
ALTER TABLE "crm"."prospects" DROP CONSTRAINT IF EXISTS "prospects_disqualified_reason_check";--> statement-breakpoint
ALTER TABLE "crm"."prospects" ADD CONSTRAINT "prospects_disqualified_reason_check"
  CHECK (
    "disqualified_reason" IS NULL
    OR "disqualified_reason" IN (
      'is_a_timing_company',
      'other'
    )
  );
