ALTER TABLE "crm"."email_templates" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_templates_shared_name_uidx"
  ON "crm"."email_templates" ("name")
  WHERE "user_id" IS NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "crm"."cadences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cadences_name_uidx" UNIQUE ("name")
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "crm"."cadence_steps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "cadence_id" uuid NOT NULL REFERENCES "crm"."cadences"("id") ON DELETE CASCADE,
  "step_order" integer NOT NULL,
  "offset_days" integer NOT NULL,
  "email_template_id" uuid NOT NULL REFERENCES "crm"."email_templates"("id") ON DELETE RESTRICT,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cadence_steps_order_positive_check" CHECK ("step_order" > 0),
  CONSTRAINT "cadence_steps_offset_nonnegative_check" CHECK ("offset_days" >= 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cadence_steps_cadence_order_uidx"
  ON "crm"."cadence_steps" ("cadence_id", "step_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cadence_steps_template_idx"
  ON "crm"."cadence_steps" ("email_template_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "crm"."cadence_enrollments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "cadence_id" uuid NOT NULL REFERENCES "crm"."cadences"("id") ON DELETE RESTRICT,
  "prospect_id" uuid NOT NULL REFERENCES "crm"."prospects"("id") ON DELETE CASCADE,
  "status" text NOT NULL,
  "current_step_order" integer,
  "enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
  "enrolled_by_user_id" uuid REFERENCES "crm"."users"("id") ON DELETE SET NULL,
  "exited_at" timestamp with time zone,
  "exited_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cadence_enrollments_status_check"
    CHECK ("status" IN ('active', 'completed', 'exited_manual', 'exited_reply')),
  CONSTRAINT "cadence_enrollments_exit_reason_check"
    CHECK (
      "exited_reason" IS NULL OR "exited_reason" IN (
        'declined_by_user',
        'reply_detected',
        'completed_cadence'
      )
    )
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cadence_enrollments_active_prospect_uidx"
  ON "crm"."cadence_enrollments" ("prospect_id")
  WHERE "status" = 'active';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cadence_enrollments_prospect_idx"
  ON "crm"."cadence_enrollments" ("prospect_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cadence_enrollments_status_idx"
  ON "crm"."cadence_enrollments" ("status");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "crm"."cadence_step_sends" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "enrollment_id" uuid NOT NULL REFERENCES "crm"."cadence_enrollments"("id") ON DELETE CASCADE,
  "cadence_step_id" uuid NOT NULL REFERENCES "crm"."cadence_steps"("id") ON DELETE RESTRICT,
  "scheduled_for" timestamp with time zone NOT NULL,
  "status" text NOT NULL,
  "email_draft_id" uuid REFERENCES "crm"."email_drafts"("id") ON DELETE SET NULL,
  "sent_at" timestamp with time zone,
  "canceled_at" timestamp with time zone,
  "canceled_by_user_id" uuid REFERENCES "crm"."users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cadence_step_sends_status_check"
    CHECK ("status" IN ('scheduled', 'sent', 'canceled'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cadence_step_sends_enrollment_step_uidx"
  ON "crm"."cadence_step_sends" ("enrollment_id", "cadence_step_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cadence_step_sends_due_idx"
  ON "crm"."cadence_step_sends" ("status", "scheduled_for");--> statement-breakpoint

INSERT INTO "crm"."email_templates" ("user_id", "name", "subject", "body_html", "kind")
VALUES
  (
    NULL,
    'Cadence — Intro',
    '{{event_name}}, timing & event support',
    $cadence$<p>{{greeting_line}}</p>
<p>We work with race organizers on {{timing_mode_line}}, medals, and general event-day support, and wanted to reach out about {{event_name}}.</p>
<p>If you've already got that piece figured out, that's awesome — we're excited for you and hope you have a great event! If you're still working through timing or medals, or just want to compare notes, we'd love to connect.</p>
<p>All my best,</p>$cadence$,
    'cadence'
  ),
  (
    NULL,
    'Cadence — Bump',
    'Quick follow up on {{event_name}}',
    $cadence$<p>{{greeting_line}}</p>
<p>Just wanted to bump the note I sent about {{event_name}}. If you've already got timing and medals squared away, no need to reply — just figured I'd check back in!</p>
<p>If you're still working through that piece, happy to connect whenever's good for you.</p>
<p>All my best,</p>$cadence$,
    'cadence'
  ),
  (
    NULL,
    'Cadence — Tip',
    'One tip for {{event_name}}''s timing',
    $cadence$<p>{{greeting_line}}</p>
<p>One thing that comes up a lot for events like {{event_name}}: timing and medal vendors tend to book up as race day gets closer, so the earlier that piece is locked in, the more options there usually are.</p>
<p>Figured that was worth flagging as you're planning, whether or not we end up being the right fit for it. If you'd like to compare notes on what's worked for similar races, happy to chat.</p>
<p>All my best,</p>$cadence$,
    'cadence'
  ),
  (
    NULL,
    'Cadence — Close',
    'Closing the loop on {{event_name}}',
    $cadence$<p>{{greeting_line}}</p>
<p>I'll leave this one here so I'm not filling your inbox for something that might already be handled. If timing or medals for {{event_name}} ever comes up as worth a second look, down the road or otherwise, I'm happy to talk whenever that is.</p>
<p>I hope you have a great event!</p>
<p>All my best,</p>$cadence$,
    'cadence'
  )
ON CONFLICT ("name") WHERE "user_id" IS NULL DO UPDATE SET
  subject = EXCLUDED.subject,
  body_html = EXCLUDED.body_html,
  kind = 'cadence',
  updated_at = now();--> statement-breakpoint

INSERT INTO "crm"."cadences" ("name", "description", "is_active")
VALUES (
  'Cold Outreach — 4 Touch',
  'Intro, day-5 bump, day-10 tip, and day-24 soft close. Offsets are from enrollment, not from the previous send.',
  true
)
ON CONFLICT ("name") DO UPDATE SET
  description = EXCLUDED.description,
  is_active = true,
  updated_at = now();--> statement-breakpoint

INSERT INTO "crm"."cadence_steps" (
  "cadence_id", "step_order", "offset_days", "email_template_id"
)
SELECT cadence.id, seed.step_order, seed.offset_days, template.id
FROM "crm"."cadences" cadence
CROSS JOIN (
  VALUES
    (1, 0, 'Cadence — Intro'),
    (2, 5, 'Cadence — Bump'),
    (3, 10, 'Cadence — Tip'),
    (4, 24, 'Cadence — Close')
) AS seed(step_order, offset_days, template_name)
JOIN "crm"."email_templates" template
  ON template.name = seed.template_name
 AND template.user_id IS NULL
 AND template.kind = 'cadence'
WHERE cadence.name = 'Cold Outreach — 4 Touch'
ON CONFLICT ("cadence_id", "step_order") DO UPDATE SET
  offset_days = EXCLUDED.offset_days,
  email_template_id = EXCLUDED.email_template_id,
  updated_at = now();
