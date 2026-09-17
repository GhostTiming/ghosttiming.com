import type { PoolClient } from "pg";
import {
  formatGmailActivityBody,
  type CanonicalGmailMessage,
} from "@/lib/google/gmail-parse";
import {
  matchEmailsToCrm,
  uniqueNormalizedEmails,
  type EmailMatchTargets,
} from "@/lib/google/email-match";
import { loadEmailMatchIndex } from "./google-queries";

export type GoogleConnectionRow = {
  id?: string;
  user_id: string;
  google_sub: string;
  google_email: string;
  gmail_history_id: string | null;
  gmail_last_synced_at: string | null;
  gmail_backfill_completed_at: string | null;
  gmail_status: string;
  gmail_last_error: string | null;
  calendar_id: string | null;
  calendar_summary: string | null;
  calendar_status: string;
  calendar_last_error: string | null;
  calendar_last_synced_at: string | null;
};

export type IngestGmailMessage = Omit<CanonicalGmailMessage, "involvedEmails"> &
  EmailMatchTargets;

export async function ingestGmailMessages(
  client: PoolClient,
  input: {
    googleSub: string;
    googleEmail: string;
    actorUserId?: string | null;
    organizationIds?: string[] | null;
    messages: IngestGmailMessage[];
  },
) {
  const indexEntries = await loadEmailMatchIndex({
    organizationIds: input.organizationIds ?? null,
  });
  const index = Object.fromEntries(
    indexEntries.map((entry) => [entry.email, entry]),
  );
  let createdActivities = 0;
  for (const message of input.messages) {
    const emails = uniqueNormalizedEmails(
      message.fromAddress,
      message.toAddresses,
      message.ccAddresses,
    );
    const matched = matchEmailsToCrm(emails, index);
    const prospectIds = [...new Set([...matched.prospectIds, ...message.prospectIds])];
    const bookingIds = [...new Set([...matched.bookingIds, ...message.bookingIds])];
    const organizationIds = [
      ...new Set([...matched.organizationIds, ...message.organizationIds]),
    ];
    const personIds = [...new Set([...matched.personIds, ...message.personIds])];
    const stored = await client.query<{ id: string }>(
      `
        INSERT INTO crm.google_email_messages (
          google_sub, google_email, gmail_message_id, gmail_thread_id,
          rfc_message_id, direction, from_address, from_name, to_addresses,
          cc_addresses, subject, snippet, body_text, occurred_at, synced_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6::crm.google_email_direction, $7, $8, $9, $10,
          $11, $12, $13, $14::timestamptz, now()
        )
        ON CONFLICT (google_sub, gmail_message_id) DO UPDATE SET
          gmail_thread_id = EXCLUDED.gmail_thread_id,
          subject = COALESCE(EXCLUDED.subject, crm.google_email_messages.subject),
          snippet = COALESCE(EXCLUDED.snippet, crm.google_email_messages.snippet),
          body_text = COALESCE(EXCLUDED.body_text, crm.google_email_messages.body_text),
          synced_at = now()
        RETURNING id::text
      `,
      [
        input.googleSub,
        input.googleEmail,
        message.gmailMessageId,
        message.gmailThreadId,
        message.rfcMessageId,
        message.direction,
        message.fromAddress,
        message.fromName,
        message.toAddresses,
        message.ccAddresses,
        message.subject,
        message.snippet,
        message.bodyText,
        message.occurredAt,
      ],
    );
    const messageId = stored.rows[0]?.id;
    if (!messageId) continue;

    const records: Array<{
      prospectId: string | null;
      bookingId: string | null;
      organizationId: string | null;
      personId: string | null;
    }> = [
      ...prospectIds.map((prospectId) => ({
        prospectId,
        bookingId: null,
        organizationId: null,
        personId: null,
      })),
      ...bookingIds.map((bookingId) => ({
        prospectId: null,
        bookingId,
        organizationId: null,
        personId: null,
      })),
      ...organizationIds.map((organizationId) => ({
        prospectId: null,
        bookingId: null,
        organizationId,
        personId: null,
      })),
      ...personIds.map((personId) => ({
        prospectId: null,
        bookingId: null,
        organizationId: null,
        personId,
      })),
    ];

    const metadata = {
      source: "gmail",
      eventType: message.direction === "incoming" ? "email_in" : "email_out",
      gmailMessageId: message.gmailMessageId,
      gmailThreadId: message.gmailThreadId,
      rfcMessageId: message.rfcMessageId,
      googleSub: input.googleSub,
    };
    const body = formatGmailActivityBody(message);

    for (const record of records) {
      const existing = await client.query<{ id: string; activity_id: string | null }>(
        `
          SELECT id::text, activity_id::text
          FROM crm.google_email_links
          WHERE message_id = $1::uuid
            AND prospect_id IS NOT DISTINCT FROM $2::uuid
            AND booking_id IS NOT DISTINCT FROM $3::uuid
            AND organization_id IS NOT DISTINCT FROM $4::uuid
            AND person_id IS NOT DISTINCT FROM $5::uuid
          LIMIT 1
        `,
        [
          messageId,
          record.prospectId,
          record.bookingId,
          record.organizationId,
          record.personId,
        ],
      );
      if (existing.rows[0]) continue;

      let activityId: string | null = null;
      if (record.prospectId || record.bookingId || record.organizationId) {
        const duplicateActivity = await client.query<{ id: string }>(
          `
            SELECT id::text
            FROM crm.activities
            WHERE metadata->>'source' = 'gmail'
              AND (
                metadata->>'gmailMessageId' = $1
                OR (
                  $5::text IS NOT NULL
                  AND metadata->>'rfcMessageId' = $5
                )
              )
              AND prospect_id IS NOT DISTINCT FROM $2::uuid
              AND booking_id IS NOT DISTINCT FROM $3::uuid
              AND organization_id IS NOT DISTINCT FROM $4::uuid
            LIMIT 1
          `,
          [
            message.gmailMessageId,
            record.prospectId,
            record.bookingId,
            record.organizationId,
            message.rfcMessageId,
          ],
        );
        if (duplicateActivity.rows[0]) {
          activityId = duplicateActivity.rows[0].id;
        } else {
          const created = await client.query<{ id: string }>(
            `
              INSERT INTO crm.activities (
                prospect_id, booking_id, organization_id, type, occurred_at,
                body, actor_type, actor_user_id, actor_name, metadata
              )
              VALUES (
                $1::uuid, $2::uuid, $3::uuid, 'email', $4::timestamptz, $5,
                'system', $7::uuid, 'Gmail Sync', $6::jsonb
              )
              RETURNING id::text
            `,
            [
              record.prospectId,
              record.bookingId,
              record.organizationId,
              message.occurredAt,
              body,
              JSON.stringify(metadata),
              input.actorUserId ?? null,
            ],
          );
          activityId = created.rows[0]?.id ?? null;
          if (activityId) createdActivities += 1;
        }
      }

      await client.query(
        `
          INSERT INTO crm.google_email_links (
            message_id, prospect_id, booking_id, organization_id, person_id, activity_id
          )
          VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid)
        `,
        [
          messageId,
          record.prospectId,
          record.bookingId,
          record.organizationId,
          record.personId,
          activityId,
        ],
      );
    }
  }
  return {
    processed: input.messages.length,
    createdActivities,
  };
}
