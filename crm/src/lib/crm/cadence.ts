import type { PoolClient } from "pg";
import { getPool } from "@/db";
import { uniqueNormalizedEmails } from "@/lib/google/email-match";
import { sendGmailMessage, getGmailMessage } from "@/lib/google/gmail-api";
import { buildGmailMime, encodeGmailRaw } from "@/lib/google/gmail-mime";
import { parseGmailMessage } from "@/lib/google/gmail-parse";
import { hasGmailSendScope } from "@/lib/google/gmail-scopes";
import {
  GoogleNeedsReauthError,
  getGoogleSessionToken,
} from "@/lib/google/google-tokens";
import { prepareProspectEmailSend } from "./email-compose";
import { ingestGmailMessages } from "./google-sync";
import {
  DEFAULT_CADENCE_NAME,
  addOffsetDays,
  cadenceSendableContactStatusSql,
  cadenceStepLabel,
  greetingLine,
  isAutomaticReply,
  renderCadenceTemplate,
  timingModeLine,
  type CadenceEnrollmentSummary,
  type CadenceRow,
  type PendingCadenceSend,
} from "./cadence-copy";

export {
  CADENCE_TEMPLATE_KIND,
  DEFAULT_CADENCE_NAME,
  cadenceStepLabel,
  greetingLine,
  isAutomaticReply,
  renderCadenceTemplate,
  timingModeLine,
} from "./cadence-copy";
export type {
  CadenceEnrollmentSummary,
  CadenceRow,
  PendingCadenceSend,
} from "./cadence-copy";

type Queryable = { query: PoolClient["query"] };

export type CadenceActor = {
  id: string;
  name: string;
  actorType?: "human" | "ai" | "system";
  actorName?: string;
  defaultSendGoogleSub?: string | null;
};

export type CadenceCommandResult = {
  enrollmentId: string;
  prospectId: string;
  sendId: string | null;
  sent: boolean;
  message: string;
};

function actorFields(actor: CadenceActor) {
  return {
    actorType: actor.actorType ?? "system",
    actorName: actor.actorName ?? (actor.actorType === "ai" ? "Claude" : "System"),
  };
}

async function withClient<T>(
  client: PoolClient | undefined,
  work: (client: PoolClient) => Promise<T>,
) {
  if (client) return work(client);
  const owned = await getPool().connect();
  try {
    return await work(owned);
  } finally {
    owned.release();
  }
}

export async function listActiveCadences(client: Queryable = getPool()) {
  const result = await client.query<CadenceRow>(
    `
      SELECT cadence.id::text, cadence.name, cadence.description, cadence.is_active,
             count(step.id)::int AS step_count
      FROM crm.cadences cadence
      LEFT JOIN crm.cadence_steps step ON step.cadence_id = cadence.id
      WHERE cadence.is_active
      GROUP BY cadence.id
      ORDER BY cadence.name
    `,
  );
  return result.rows;
}

export async function getDefaultCadence(client: Queryable = getPool()) {
  const cadences = await listActiveCadences(client);
  return (
    cadences.find((row) => row.name === DEFAULT_CADENCE_NAME) ?? cadences[0] ?? null
  );
}

export async function getProspectCadenceSummary(
  prospectId: string,
  client: Queryable = getPool(),
) {
  const result = await client.query<CadenceEnrollmentSummary>(
    `
      SELECT
        enrollment.id::text,
        enrollment.cadence_id::text,
        cadence.name AS cadence_name,
        enrollment.status,
        enrollment.current_step_order,
        (
          SELECT count(*)::int FROM crm.cadence_steps step
          WHERE step.cadence_id = enrollment.cadence_id
        ) AS step_count,
        enrollment.enrolled_at::text,
        enrollment.exited_at::text,
        enrollment.exited_reason,
        next_send.step_order AS next_step_order,
        next_send.scheduled_for::text AS next_scheduled_for
      FROM crm.cadence_enrollments enrollment
      JOIN crm.cadences cadence ON cadence.id = enrollment.cadence_id
      LEFT JOIN LATERAL (
        SELECT step.step_order, send.scheduled_for
        FROM crm.cadence_step_sends send
        JOIN crm.cadence_steps step ON step.id = send.cadence_step_id
        WHERE send.enrollment_id = enrollment.id AND send.status = 'scheduled'
        ORDER BY step.step_order
        LIMIT 1
      ) next_send ON true
      WHERE enrollment.prospect_id = $1::uuid
      ORDER BY enrollment.enrolled_at DESC
      LIMIT 1
    `,
    [prospectId],
  );
  return result.rows[0] ?? null;
}

type MergeContext = {
  prospect_id: string;
  archived_at: string | null;
  do_not_contact: boolean;
  assigned_user_id: string | null;
  event_name: string;
  state: string | null;
  first_name: string | null;
  to_addresses: string[];
};

async function loadMergeContext(client: Queryable, prospectId: string) {
  const result = await client.query<MergeContext>(
    `
      SELECT
        prospect.id::text AS prospect_id,
        prospect.archived_at::text,
        queue.do_not_contact,
        prospect.assigned_user_id::text,
        COALESCE(event.name, listing.name, 'this event') AS event_name,
        COALESCE(NULLIF(occurrence.state_override, ''), listing.state) AS state,
        person.first_name,
        COALESCE((
          SELECT array_agg(email ORDER BY email)
          FROM (
            SELECT DISTINCT lower(method.normalized_value) AS email
            FROM crm.contact_methods method
            WHERE (method.prospect_id = prospect.id
              OR (method.prospect_id IS NULL AND method.race_listing_id = prospect.race_listing_id))
              AND method.type = 'email'
              AND ${cadenceSendableContactStatusSql("method")}
            UNION
            SELECT lower(person.email)
            WHERE person.email IS NOT NULL
          ) emails
        ), ARRAY[]::text[]) AS to_addresses
      FROM crm.prospects prospect
      JOIN crm.prospect_work_queue queue ON queue.prospect_id = prospect.id
      LEFT JOIN crm.events event ON event.id = prospect.event_id
      LEFT JOIN catalog.race_listings listing
        ON listing.id = COALESCE(prospect.race_listing_id, event.catalog_race_listing_id)
      LEFT JOIN crm.event_occurrences occurrence ON occurrence.id = prospect.occurrence_id
      LEFT JOIN crm.people person ON person.id = prospect.primary_contact_person_id
      WHERE prospect.id = $1::uuid
    `,
    [prospectId],
  );
  return result.rows[0] ?? null;
}

async function loadDefaultSignatureHtml(client: Queryable, userId: string) {
  const result = await client.query<{ body_html: string }>(
    `
      SELECT body_html
      FROM crm.email_signatures
      WHERE user_id = $1::uuid
      ORDER BY is_default DESC, name ASC
      LIMIT 1
    `,
    [userId],
  );
  return result.rows[0]?.body_html ?? null;
}

function pendingScopeSql(alias: string) {
  return `(
    ${alias}.assigned_user_id = $1::uuid
    OR ($2::boolean AND ${alias}.assigned_user_id IS NULL)
  )`;
}

export async function countPendingCadenceSends(input: {
  userId: string;
  includeUnassigned: boolean;
  client?: Queryable;
}) {
  const client = input.client ?? getPool();
  const result = await client.query<{ count: string }>(
    `
      SELECT count(*)::text AS count
      FROM crm.cadence_step_sends send
      JOIN crm.cadence_enrollments enrollment ON enrollment.id = send.enrollment_id
      JOIN crm.prospects prospect ON prospect.id = enrollment.prospect_id
      WHERE send.status = 'scheduled'
        AND send.scheduled_for <= now()
        AND enrollment.status = 'active'
        AND prospect.archived_at IS NULL
        AND ${pendingScopeSql("prospect")}
    `,
    [input.userId, input.includeUnassigned],
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function listPendingCadenceSends(input: {
  userId: string;
  includeUnassigned: boolean;
  client?: Queryable;
}): Promise<PendingCadenceSend[]> {
  const client = input.client ?? getPool();
  const rows = await client.query<{
    send_id: string;
    enrollment_id: string;
    prospect_id: string;
    race_name: string;
    cadence_name: string;
    step_order: number;
    step_count: number;
    scheduled_for: string;
    template_subject: string;
    template_body_html: string;
    first_name: string | null;
    event_name: string;
    state: string | null;
    to_addresses: string[];
    signature_html: string | null;
  }>(
    `
      SELECT
        send.id::text AS send_id,
        enrollment.id::text AS enrollment_id,
        prospect.id::text AS prospect_id,
        COALESCE(event.name, listing.name, 'Untitled race') AS race_name,
        cadence.name AS cadence_name,
        step.step_order,
        (
          SELECT count(*)::int FROM crm.cadence_steps all_steps
          WHERE all_steps.cadence_id = cadence.id
        ) AS step_count,
        send.scheduled_for::text,
        template.subject AS template_subject,
        template.body_html AS template_body_html,
        person.first_name,
        COALESCE(event.name, listing.name, 'this event') AS event_name,
        COALESCE(NULLIF(occurrence.state_override, ''), listing.state) AS state,
        COALESCE((
          SELECT array_agg(email ORDER BY email)
          FROM (
            SELECT DISTINCT lower(method.normalized_value) AS email
            FROM crm.contact_methods method
            WHERE (method.prospect_id = prospect.id
              OR (method.prospect_id IS NULL AND method.race_listing_id = prospect.race_listing_id))
              AND method.type = 'email'
              AND ${cadenceSendableContactStatusSql("method")}
            UNION
            SELECT lower(person.email)
            WHERE person.email IS NOT NULL
          ) emails
        ), ARRAY[]::text[]) AS to_addresses,
        signature.body_html AS signature_html
      FROM crm.cadence_step_sends send
      JOIN crm.cadence_enrollments enrollment ON enrollment.id = send.enrollment_id
      JOIN crm.cadences cadence ON cadence.id = enrollment.cadence_id
      JOIN crm.cadence_steps step ON step.id = send.cadence_step_id
      JOIN crm.email_templates template ON template.id = step.email_template_id
      JOIN crm.prospects prospect ON prospect.id = enrollment.prospect_id
      LEFT JOIN crm.events event ON event.id = prospect.event_id
      LEFT JOIN catalog.race_listings listing
        ON listing.id = COALESCE(prospect.race_listing_id, event.catalog_race_listing_id)
      LEFT JOIN crm.event_occurrences occurrence ON occurrence.id = prospect.occurrence_id
      LEFT JOIN crm.people person ON person.id = prospect.primary_contact_person_id
      LEFT JOIN LATERAL (
        SELECT body_html
        FROM crm.email_signatures
        WHERE user_id = $1::uuid
        ORDER BY is_default DESC, name ASC
        LIMIT 1
      ) signature ON true
      WHERE send.status = 'scheduled'
        AND send.scheduled_for <= now()
        AND enrollment.status = 'active'
        AND prospect.archived_at IS NULL
        AND ${pendingScopeSql("prospect")}
      ORDER BY send.scheduled_for ASC, step.step_order ASC
    `,
    [input.userId, input.includeUnassigned],
  );
  return rows.rows.map((row) => {
    const rendered = renderCadenceTemplate({
      subject: row.template_subject,
      bodyHtml: row.template_body_html,
      greetingLine: greetingLine(row.first_name),
      eventName: row.event_name,
      timingModeLine: timingModeLine(row.state),
      signatureHtml: row.signature_html,
    });
    return {
      send_id: row.send_id,
      enrollment_id: row.enrollment_id,
      prospect_id: row.prospect_id,
      race_name: row.race_name,
      cadence_name: row.cadence_name,
      step_order: row.step_order,
      step_count: row.step_count,
      scheduled_for: row.scheduled_for,
      subject: rendered.subject,
      body_html: rendered.bodyHtml,
      to_addresses: row.to_addresses,
    };
  });
}

async function loadStep(client: Queryable, cadenceId: string, stepOrder: number) {
  const result = await client.query<{
    id: string;
    step_order: number;
    offset_days: number;
    email_template_id: string;
    subject: string;
    body_html: string;
    step_count: number;
  }>(
    `
      SELECT
        step.id::text,
        step.step_order,
        step.offset_days,
        step.email_template_id::text,
        template.subject,
        template.body_html,
        (
          SELECT count(*)::int FROM crm.cadence_steps all_steps
          WHERE all_steps.cadence_id = step.cadence_id
        ) AS step_count
      FROM crm.cadence_steps step
      JOIN crm.email_templates template ON template.id = step.email_template_id
      WHERE step.cadence_id = $1::uuid AND step.step_order = $2
      LIMIT 1
    `,
    [cadenceId, stepOrder],
  );
  return result.rows[0] ?? null;
}

async function previousThread(client: Queryable, enrollmentId: string) {
  const result = await client.query<{
    gmail_thread_id: string | null;
    rfc_message_id: string | null;
    sent_gmail_message_id: string | null;
  }>(
    `
      SELECT draft.gmail_thread_id, message.rfc_message_id, draft.sent_gmail_message_id
      FROM crm.cadence_step_sends send
      JOIN crm.email_drafts draft ON draft.id = send.email_draft_id
      LEFT JOIN crm.google_email_messages message
        ON message.gmail_message_id = draft.sent_gmail_message_id
      WHERE send.enrollment_id = $1::uuid AND send.status = 'sent'
      ORDER BY send.sent_at DESC NULLS LAST
      LIMIT 1
    `,
    [enrollmentId],
  );
  return result.rows[0] ?? null;
}

async function insertCadenceActivity(
  client: PoolClient,
  input: {
    prospectId: string;
    actor: CadenceActor;
    body: string;
    metadata: Record<string, unknown>;
    type?: "email" | "note";
  },
) {
  const actor = actorFields(input.actor);
  await client.query(
    `
      INSERT INTO crm.activities (
        prospect_id, type, body, actor_type, actor_user_id, actor_name, metadata
      )
      VALUES (
        $1::uuid, $2::crm.activity_type, $3, $4::crm.actor_type, $5::uuid, $6, $7::jsonb
      )
    `,
    [
      input.prospectId,
      input.type ?? "email",
      input.body,
      actor.actorType,
      actor.actorType === "human" ? input.actor.id : null,
      actor.actorName,
      JSON.stringify(input.metadata),
    ],
  );
}

async function sendRenderedCadenceEmail(input: {
  client: PoolClient;
  actor: CadenceActor;
  prospectId: string;
  sendId: string;
  enrollmentId: string;
  cadenceId: string;
  step: {
    id: string;
    step_order: number;
    offset_days: number;
    subject: string;
    body_html: string;
    step_count: number;
  };
  context: MergeContext;
  enrolledAt: Date;
}) {
  const signatureHtml = await loadDefaultSignatureHtml(input.client, input.actor.id);
  const rendered = renderCadenceTemplate({
    subject: input.step.subject,
    bodyHtml: input.step.body_html,
    greetingLine: greetingLine(input.context.first_name),
    eventName: input.context.event_name,
    timingModeLine: timingModeLine(input.context.state),
    signatureHtml,
  });
  const thread = await previousThread(input.client, input.enrollmentId);
  const prepared = await prepareProspectEmailSend(input.client, {
    prospectId: input.prospectId,
    toAddresses: uniqueNormalizedEmails(input.context.to_addresses),
    ccAddresses: [],
    subject: rendered.subject,
    bodyText: rendered.bodyText,
    gmailThreadId: thread?.gmail_thread_id ?? null,
    inReplyToRfcMessageId: thread?.rfc_message_id ?? null,
    replyToGmailMessageId: thread?.sent_gmail_message_id ?? null,
  });
  if (!prepared.allowed) {
    throw new Error(prepared.error);
  }

  const token = await getGoogleSessionToken(
    input.actor.id,
    input.actor.defaultSendGoogleSub,
  );
  if (!hasGmailSendScope(token.scope)) {
    throw new GoogleNeedsReauthError(
      "Gmail send permission is missing. Connect Google again and allow sending.",
    );
  }

  const mime = buildGmailMime({
    from: token.googleEmail,
    to: prepared.toAddresses,
    subject: prepared.subject,
    body: rendered.bodyText,
    html: rendered.bodyHtml,
    inReplyTo: prepared.inReplyToRfcMessageId,
    references: prepared.inReplyToRfcMessageId,
  });
  const sent = await sendGmailMessage(token.accessToken, {
    raw: encodeGmailRaw(mime),
    threadId: prepared.gmailThreadId,
  });
  if (!sent.id) throw new Error("Gmail did not return a message id.");

  let parsed = null;
  try {
    const raw = await getGmailMessage(token.accessToken, sent.id);
    parsed = parseGmailMessage(raw, token.googleEmail);
  } catch {
    parsed = null;
  }

  await input.client.query("BEGIN");
  try {
  const draft = await input.client.query<{ id: string }>(
    `
      INSERT INTO crm.email_drafts (
        prospect_id, created_by_user_id, gmail_thread_id,
        in_reply_to_rfc_message_id, reply_to_gmail_message_id,
        to_addresses, cc_addresses, subject, body_text,
        sent_at, sent_gmail_message_id
      )
      VALUES (
        $1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, now(), $10
      )
      RETURNING id::text
    `,
    [
      input.prospectId,
      input.actor.id,
      sent.threadId ?? prepared.gmailThreadId,
      prepared.inReplyToRfcMessageId,
      prepared.replyToGmailMessageId,
      prepared.toAddresses,
      prepared.ccAddresses,
      prepared.subject,
      rendered.bodyText,
      sent.id,
    ],
  );

  const nextStep = await loadStep(
    input.client,
    input.cadenceId,
    input.step.step_order + 1,
  );
  const completed = !nextStep;

  await input.client.query(
    `
      UPDATE crm.cadence_step_sends
      SET status = 'sent',
          email_draft_id = $2::uuid,
          sent_at = now(),
          updated_at = now()
      WHERE id = $1::uuid AND status = 'scheduled'
    `,
    [input.sendId, draft.rows[0].id],
  );
  await input.client.query(
    `
      UPDATE crm.cadence_enrollments
      SET current_step_order = $2,
          status = CASE WHEN $3 THEN 'completed' ELSE status END,
          exited_at = CASE WHEN $3 THEN now() ELSE exited_at END,
          exited_reason = CASE WHEN $3 THEN 'completed_cadence' ELSE exited_reason END,
          updated_at = now()
      WHERE id = $1::uuid AND status = 'active'
    `,
    [input.enrollmentId, input.step.step_order, completed],
  );
  if (nextStep) {
    await input.client.query(
      `
        INSERT INTO crm.cadence_step_sends (
          enrollment_id, cadence_step_id, scheduled_for, status
        )
        VALUES ($1::uuid, $2::uuid, $3::timestamptz, 'scheduled')
        ON CONFLICT (enrollment_id, cadence_step_id) DO NOTHING
      `,
      [
        input.enrollmentId,
        nextStep.id,
        addOffsetDays(input.enrolledAt, nextStep.offset_days).toISOString(),
      ],
    );
  }

  await insertCadenceActivity(input.client, {
    prospectId: input.prospectId,
    actor: input.actor,
    body:
      input.step.step_order === 1
        ? "Cadence step 1 sent automatically"
        : `Cadence ${cadenceStepLabel(input.step.step_order, input.step.step_count)} sent.`,
    metadata: {
      source: "cadence",
      cadenceId: input.cadenceId,
      enrollmentId: input.enrollmentId,
      stepOrder: input.step.step_order,
      gmailMessageId: sent.id,
      gmailThreadId: sent.threadId ?? parsed?.gmailThreadId ?? null,
    },
  });

  if (parsed) {
    await ingestGmailMessages(input.client, {
      googleSub: token.googleSub,
      googleEmail: token.googleEmail,
      actorUserId: input.actor.id,
      messages: [
        {
          ...parsed,
          prospectIds: [input.prospectId],
          bookingIds: [],
          organizationIds: [],
          personIds: [],
        },
      ],
    });
  }

  await input.client.query("COMMIT");
  return {
    sentId: sent.id,
    completed,
    nextStepOrder: nextStep?.step_order ?? null,
  };
  } catch (error) {
    try {
      await input.client.query("ROLLBACK");
    } catch {
      /* no open transaction */
    }
    await input.client.query(
      `
        UPDATE crm.cadence_step_sends
        SET status = 'sent',
            sent_at = COALESCE(sent_at, now()),
            updated_at = now()
        WHERE id = $1::uuid AND status = 'scheduled'
      `,
      [input.sendId],
    );
    throw error;
  }
}

export async function enrollProspectInCadence(input: {
  prospectId: string;
  cadenceId?: string | null;
  actor: CadenceActor;
  client?: PoolClient;
}): Promise<CadenceCommandResult> {
  return withClient(input.client, async (client) => {
    const cadence = input.cadenceId
      ? (await listActiveCadences(client)).find((row) => row.id === input.cadenceId)
      : await getDefaultCadence(client);
    if (!cadence) throw new Error("No active cadence is set up.");
    const step = await loadStep(client, cadence.id, 1);
    if (!step) throw new Error("That cadence has no steps.");

    const context = await loadMergeContext(client, input.prospectId);
    if (!context) throw new Error("That lead was not found.");
    if (context.archived_at) throw new Error("This lead is archived.");
    if (context.do_not_contact) {
      throw new Error("This lead is marked Do Not Contact.");
    }
    if (!uniqueNormalizedEmails(context.to_addresses).length) {
      throw new Error("Add an email address before starting the cadence.");
    }

    const existing = await client.query<{ id: string }>(
      `
        SELECT id::text FROM crm.cadence_enrollments
        WHERE prospect_id = $1::uuid AND status = 'active'
        LIMIT 1
      `,
      [input.prospectId],
    );
    if (existing.rows[0]) {
      throw new Error("This lead is already in an active cadence.");
    }

    await getGoogleSessionToken(input.actor.id, input.actor.defaultSendGoogleSub);

    const enrollment = await client.query<{ id: string; enrolled_at: string }>(
      `
        INSERT INTO crm.cadence_enrollments (
          cadence_id, prospect_id, status, enrolled_by_user_id
        )
        VALUES ($1::uuid, $2::uuid, 'active', $3::uuid)
        RETURNING id::text, enrolled_at::text
      `,
      [cadence.id, input.prospectId, input.actor.id],
    );
    const enrolledAt = new Date(enrollment.rows[0].enrolled_at);
    const send = await client.query<{ id: string }>(
      `
        INSERT INTO crm.cadence_step_sends (
          enrollment_id, cadence_step_id, scheduled_for, status
        )
        VALUES ($1::uuid, $2::uuid, $3::timestamptz, 'scheduled')
        RETURNING id::text
      `,
      [enrollment.rows[0].id, step.id, enrolledAt.toISOString()],
    );

    try {
      const sent = await sendRenderedCadenceEmail({
        client,
        actor: input.actor,
        prospectId: input.prospectId,
        sendId: send.rows[0].id,
        enrollmentId: enrollment.rows[0].id,
        cadenceId: cadence.id,
        step,
        context,
        enrolledAt,
      });
      return {
        enrollmentId: enrollment.rows[0].id,
        prospectId: input.prospectId,
        sendId: send.rows[0].id,
        sent: true,
        message: sent.completed
          ? "Cadence finished after the first email."
          : "Cadence started and the first email was sent.",
      };
    } catch (error) {
      return {
        enrollmentId: enrollment.rows[0].id,
        prospectId: input.prospectId,
        sendId: send.rows[0].id,
        sent: false,
        message:
          error instanceof Error
            ? `Cadence started. The first email is waiting in Pending emails: ${error.message}`
            : "Cadence started. The first email is waiting in Pending emails.",
      };
    }
  });
}

export async function approveCadenceStepSend(input: {
  sendId: string;
  actor: CadenceActor;
}): Promise<CadenceCommandResult> {
  const client = await getPool().connect();
  try {
    const row = await client.query<{
      send_id: string;
      enrollment_id: string;
      cadence_id: string;
      prospect_id: string;
      enrolled_at: string;
      step_id: string;
      step_order: number;
      offset_days: number;
      subject: string;
      body_html: string;
      step_count: number;
    }>(
      `
        SELECT
          send.id::text AS send_id,
          enrollment.id::text AS enrollment_id,
          enrollment.cadence_id::text,
          enrollment.prospect_id::text,
          enrollment.enrolled_at::text,
          step.id::text AS step_id,
          step.step_order,
          step.offset_days,
          template.subject,
          template.body_html,
          (
            SELECT count(*)::int FROM crm.cadence_steps all_steps
            WHERE all_steps.cadence_id = enrollment.cadence_id
          ) AS step_count
        FROM crm.cadence_step_sends send
        JOIN crm.cadence_enrollments enrollment ON enrollment.id = send.enrollment_id
        JOIN crm.cadence_steps step ON step.id = send.cadence_step_id
        JOIN crm.email_templates template ON template.id = step.email_template_id
        JOIN crm.prospects prospect ON prospect.id = enrollment.prospect_id
        WHERE send.id = $1::uuid
          AND send.status = 'scheduled'
          AND send.scheduled_for <= now()
          AND enrollment.status = 'active'
      `,
      [input.sendId],
    );
    const send = row.rows[0];
    if (!send) {
      throw new Error("That cadence email is not waiting for approval.");
    }
    const context = await loadMergeContext(client, send.prospect_id);
    if (!context) throw new Error("That lead was not found.");
    const result = await sendRenderedCadenceEmail({
      client,
      actor: input.actor,
      prospectId: send.prospect_id,
      sendId: send.send_id,
      enrollmentId: send.enrollment_id,
      cadenceId: send.cadence_id,
      step: {
        id: send.step_id,
        step_order: send.step_order,
        offset_days: send.offset_days,
        subject: send.subject,
        body_html: send.body_html,
        step_count: send.step_count,
      },
      context,
      enrolledAt: new Date(send.enrolled_at),
    });
    return {
      enrollmentId: send.enrollment_id,
      prospectId: send.prospect_id,
      sendId: send.send_id,
      sent: true,
      message: result.completed
        ? "Last cadence email sent; this lead finished the sequence."
        : "Email sent. The next touch is scheduled.",
    };
  } finally {
    client.release();
  }
}

export async function declineCadenceStepSend(input: {
  sendId: string;
  actor: CadenceActor;
}): Promise<CadenceCommandResult> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const row = await client.query<{
      send_id: string;
      enrollment_id: string;
      prospect_id: string;
    }>(
      `
        SELECT send.id::text AS send_id,
               enrollment.id::text AS enrollment_id,
               enrollment.prospect_id::text
        FROM crm.cadence_step_sends send
        JOIN crm.cadence_enrollments enrollment ON enrollment.id = send.enrollment_id
        WHERE send.id = $1::uuid
          AND send.status = 'scheduled'
          AND enrollment.status = 'active'
        FOR UPDATE OF send, enrollment
      `,
      [input.sendId],
    );
    const send = row.rows[0];
    if (!send) throw new Error("That cadence email is not waiting for a decision.");

    await client.query(
      `
        UPDATE crm.cadence_step_sends
        SET status = 'canceled',
            canceled_at = now(),
            canceled_by_user_id = $2::uuid,
            updated_at = now()
        WHERE enrollment_id = $1::uuid AND status = 'scheduled'
      `,
      [send.enrollment_id, input.actor.id],
    );
    await client.query(
      `
        UPDATE crm.cadence_enrollments
        SET status = 'exited_manual',
            exited_at = now(),
            exited_reason = 'declined_by_user',
            updated_at = now()
        WHERE id = $1::uuid
      `,
      [send.enrollment_id],
    );
    await insertCadenceActivity(client, {
      prospectId: send.prospect_id,
      actor: { ...input.actor, actorType: "human", actorName: input.actor.name },
      type: "note",
      body: "Removed from cadence after a pending email was declined. Pipeline stage was left unchanged.",
      metadata: {
        source: "cadence",
        enrollmentId: send.enrollment_id,
        sendId: send.send_id,
        reason: "declined_by_user",
      },
    });
    await client.query("COMMIT");
    return {
      enrollmentId: send.enrollment_id,
      prospectId: send.prospect_id,
      sendId: send.send_id,
      sent: false,
      message: "Removed from the cadence. The lead stage was not changed.",
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function processCadenceReplies(client?: PoolClient) {
  return withClient(client, async (owned) => {
    const candidates = await owned.query<{
      enrollment_id: string;
      prospect_id: string;
      gmail_message_id: string;
      subject: string | null;
      from_address: string | null;
      snippet: string | null;
      body_text: string | null;
    }>(
      `
        SELECT
          enrollment.id::text AS enrollment_id,
          enrollment.prospect_id::text,
          message.gmail_message_id,
          message.subject,
          message.from_address,
          message.snippet,
          message.body_text
        FROM crm.cadence_enrollments enrollment
        JOIN crm.google_email_links link ON link.prospect_id = enrollment.prospect_id
        JOIN crm.google_email_messages message ON message.id = link.message_id
        WHERE enrollment.status = 'active'
          AND message.direction = 'incoming'
          AND message.occurred_at > (
            SELECT max(latest.sent_at)
            FROM crm.cadence_step_sends latest
            WHERE latest.enrollment_id = enrollment.id AND latest.status = 'sent'
          )
        ORDER BY enrollment.id, message.occurred_at ASC
      `,
    );

    const grouped = new Map<string, typeof candidates.rows>();
    for (const row of candidates.rows) {
      const current = grouped.get(row.enrollment_id) ?? [];
      current.push(row);
      grouped.set(row.enrollment_id, current);
    }

    let exited = 0;
    let automatic = 0;
    for (const [enrollmentId, messages] of grouped) {
      const prospectId = messages[0].prospect_id;
      const human = messages.find(
        (row) =>
          !isAutomaticReply({
            subject: row.subject,
            fromAddress: row.from_address,
            snippet: row.snippet,
            bodyText: row.body_text,
          }),
      );
      if (!human) {
        for (const row of messages) {
          automatic += 1;
          const noted = await owned.query<{ id: string }>(
            `
              SELECT id::text FROM crm.activities
              WHERE prospect_id = $1::uuid
                AND metadata->>'source' = 'cadence'
                AND metadata->>'gmailMessageId' = $2
                AND metadata->>'reason' = 'automatic_reply'
              LIMIT 1
            `,
            [prospectId, row.gmail_message_id],
          );
          if (noted.rows[0]) continue;
          await insertCadenceActivity(owned, {
            prospectId,
            actor: { id: prospectId, name: "System", actorType: "system" },
            type: "note",
            body: "Automatic reply received after a cadence email; left in the cadence.",
            metadata: {
              source: "cadence",
              enrollmentId,
              gmailMessageId: row.gmail_message_id,
              reason: "automatic_reply",
            },
          });
        }
        continue;
      }

      await owned.query(
        `
          UPDATE crm.cadence_step_sends
          SET status = 'canceled',
              canceled_at = now(),
              updated_at = now()
          WHERE enrollment_id = $1::uuid AND status = 'scheduled'
        `,
        [enrollmentId],
      );
      const updated = await owned.query<{ id: string }>(
        `
          UPDATE crm.cadence_enrollments
          SET status = 'exited_reply',
              exited_at = now(),
              exited_reason = 'reply_detected',
              updated_at = now()
          WHERE id = $1::uuid AND status = 'active'
          RETURNING id::text
        `,
        [enrollmentId],
      );
      if (!updated.rows[0]) continue;
      await insertCadenceActivity(owned, {
        prospectId,
        actor: { id: prospectId, name: "System", actorType: "system" },
        type: "note",
        body: "Reply detected, removed from cadence automatically.",
        metadata: {
          source: "cadence",
          enrollmentId,
          gmailMessageId: human.gmail_message_id,
          reason: "reply_detected",
        },
      });
      exited += 1;
    }
    return { exited, automatic, scanned: candidates.rows.length };
  });
}
