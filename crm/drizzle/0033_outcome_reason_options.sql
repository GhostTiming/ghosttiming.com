ALTER TABLE "crm"."prospects" DROP CONSTRAINT IF EXISTS "prospects_unqualified_reason_check";--> statement-breakpoint
ALTER TABLE "crm"."prospects" ADD CONSTRAINT "prospects_unqualified_reason_check"
  CHECK (
    "unqualified_reason" IS NULL
    OR "unqualified_reason" IN (
      'event_too_soon',
      'already_has_timer',
      'untimed_event',
      'no_need',
      'other'
    )
  );--> statement-breakpoint
ALTER TABLE "crm"."prospects" DROP CONSTRAINT IF EXISTS "prospects_disqualified_reason_check";--> statement-breakpoint
ALTER TABLE "crm"."prospects" ADD CONSTRAINT "prospects_disqualified_reason_check"
  CHECK (
    "disqualified_reason" IS NULL
    OR "disqualified_reason" IN (
      'is_a_timing_company',
      'blacklisted_email',
      'do_not_contact',
      'race_canceled',
      'other'
    )
  );
