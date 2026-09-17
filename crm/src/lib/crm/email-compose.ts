import type { PoolClient } from "pg";
import { uniqueNormalizedEmails } from "../google/email-match";
import { replySubject } from "../google/gmail-mime";
import { emailMatchesBlacklist, listEmailBlacklist } from "./email-blacklist";
import { normalizeEmail } from "../contact-extraction/extract";

export type EmailDraftRow = {
  id: string;
  prospect_id: string;
  created_by_user_id: string | null;
  gmail_thread_id: string | null;
  in_reply_to_rfc_message_id: string | null;
  reply_to_gmail_message_id: string | null;
  to_addresses: string[];
  cc_addresses: string[];
  subject: string;
  body_text: string;
  sent_at: string | null;
  sent_gmail_message_id: string | null;
  updated_at: string;
  created_at: string;
};

export type ProspectEmailMessage = {
  gmail_message_id: string;
  gmail_thread_id: string | null;
  rfc_message_id: string | null;
  direction: "incoming" | "outgoing";
  from_address: string | null;
  from_name: string | null;
  to_addresses: string[];
  cc_addresses: string[];
  subject: string | null;
  snippet: string | null;
  body_text: string | null;
  occurred_at: string;
};

export type ProspectEmailThread = {
  gmailThreadId: string;
  subject: string | null;
  lastOccurredAt: string;
  messageCount: number;
  lastFrom: string | null;
  lastSnippet: string | null;
  lastRfcMessageId: string | null;
  lastGmailMessageId: string;
  lastDirection: "incoming" | "outgoing";
  replyTo: string[];
  replyCc: string[];
};

export type EmailComposeInput = {
  toAddresses: string[];
  ccAddresses: string[];
  subject: string;
  bodyText: string;
  gmailThreadId?: string | null;
  inReplyToRfcMessageId?: string | null;
  replyToGmailMessageId?: string | null;
};

export function parseRecipientField(value: string) {
  return uniqueNormalizedEmails(
    value.split(/[;,\n]+/).map((part) => {
      const angled = part.match(/<([^>]+)>/);
      return (angled?.[1] ?? part).trim();
    }),
  );
}

export function formatRecipientField(emails: string[]) {
  return uniqueNormalizedEmails(emails).join(", ");
}

export function replyRecipients(input: {
  connectedEmail?: string | null;
  lastDirection: "incoming" | "outgoing";
  fromAddress: string | null;
  toAddresses: string[];
  ccAddresses: string[];
}) {
  const connected = normalizeEmail(input.connectedEmail ?? "");
  const withoutSelf = (emails: Array<string | null | undefined>) =>
    uniqueNormalizedEmails(...emails).filter((email) => email !== connected);

  if (input.lastDirection === "incoming") {
    const to = withoutSelf([input.fromAddress]);
    const cc = withoutSelf([...input.toAddresses, ...input.ccAddresses]).filter(
      (email) => !to.includes(email),
    );
    return { to: to.length ? to : withoutSelf(input.toAddresses), cc };
  }
  return {
    to: withoutSelf(input.toAddresses),
    cc: withoutSelf(input.ccAddresses),
  };
}

export function groupMessagesIntoThreads(
  messages: ProspectEmailMessage[],
  connectedEmail?: string | null,
): ProspectEmailThread[] {
  const byThread = new Map<string, ProspectEmailMessage[]>();
  for (const message of messages) {
    const threadId = message.gmail_thread_id?.trim() || message.gmail_message_id;
    const current = byThread.get(threadId) ?? [];
    current.push(message);
    byThread.set(threadId, current);
  }
  return [...byThread.entries()]
    .map(([gmailThreadId, threadMessages]) => {
      const ordered = [...threadMessages].sort((left, right) =>
        left.occurred_at.localeCompare(right.occurred_at),
      );
      const last = ordered[ordered.length - 1];
      const recipients = replyRecipients({
        connectedEmail,
        lastDirection: last.direction,
        fromAddress: last.from_address,
        toAddresses: last.to_addresses,
        ccAddresses: last.cc_addresses,
      });
      return {
        gmailThreadId,
        subject: last.subject,
        lastOccurredAt: last.occurred_at,
        messageCount: ordered.length,
        lastFrom: last.from_address,
        lastSnippet: last.snippet || last.body_text,
        lastRfcMessageId: last.rfc_message_id,
        lastGmailMessageId: last.gmail_message_id,
        lastDirection: last.direction,
        replyTo: recipients.to,
        replyCc: recipients.cc,
      };
    })
    .sort((left, right) => right.lastOccurredAt.localeCompare(left.lastOccurredAt));
}

export async function listProspectEmailDrafts(
  client: { query: PoolClient["query"] },
  prospectId: string,
) {
  const result = await client.query<EmailDraftRow>(
    `
      SELECT id::text, prospect_id::text, created_by_user_id::text,
             gmail_thread_id, in_reply_to_rfc_message_id, reply_to_gmail_message_id,
             to_addresses, cc_addresses, subject, body_text,
             sent_at::text, sent_gmail_message_id,
             updated_at::text, created_at::text
      FROM crm.email_drafts
      WHERE prospect_id = $1::uuid AND sent_at IS NULL
      ORDER BY updated_at DESC
    `,
    [prospectId],
  );
  return result.rows;
}

export async function listProspectEmailMessages(
  client: { query: PoolClient["query"] },
  prospectId: string,
) {
  const result = await client.query<ProspectEmailMessage>(
    `
      SELECT msg.gmail_message_id, msg.gmail_thread_id, msg.rfc_message_id,
             msg.direction::text AS direction, msg.from_address, msg.from_name,
             msg.to_addresses, msg.cc_addresses, msg.subject, msg.snippet,
             msg.body_text, msg.occurred_at::text
      FROM crm.google_email_messages msg
      JOIN crm.google_email_links link ON link.message_id = msg.id
      WHERE link.prospect_id = $1::uuid
      ORDER BY msg.occurred_at ASC, msg.created_at ASC
    `,
    [prospectId],
  );
  return result.rows;
}

export async function saveProspectEmailDraft(
  client: PoolClient,
  input: EmailComposeInput & {
    prospectId: string;
    draftId?: string | null;
    actorUserId: string;
  },
) {
  if (input.draftId) {
    const updated = await client.query<EmailDraftRow>(
      `
        UPDATE crm.email_drafts
        SET to_addresses = $3,
            cc_addresses = $4,
            subject = $5,
            body_text = $6,
            gmail_thread_id = $7,
            in_reply_to_rfc_message_id = $8,
            reply_to_gmail_message_id = $9,
            updated_at = now()
        WHERE id = $1::uuid
          AND prospect_id = $2::uuid
          AND sent_at IS NULL
        RETURNING id::text, prospect_id::text, created_by_user_id::text,
                  gmail_thread_id, in_reply_to_rfc_message_id, reply_to_gmail_message_id,
                  to_addresses, cc_addresses, subject, body_text,
                  sent_at::text, sent_gmail_message_id,
                  updated_at::text, created_at::text
      `,
      [
        input.draftId,
        input.prospectId,
        input.toAddresses,
        input.ccAddresses,
        input.subject,
        input.bodyText,
        input.gmailThreadId ?? null,
        input.inReplyToRfcMessageId ?? null,
        input.replyToGmailMessageId ?? null,
      ],
    );
    if (!updated.rows[0]) throw new Error("That draft was not found.");
    return updated.rows[0];
  }
  const created = await client.query<EmailDraftRow>(
    `
      INSERT INTO crm.email_drafts (
        prospect_id, created_by_user_id, gmail_thread_id,
        in_reply_to_rfc_message_id, reply_to_gmail_message_id,
        to_addresses, cc_addresses, subject, body_text
      )
      VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id::text, prospect_id::text, created_by_user_id::text,
                gmail_thread_id, in_reply_to_rfc_message_id, reply_to_gmail_message_id,
                to_addresses, cc_addresses, subject, body_text,
                sent_at::text, sent_gmail_message_id,
                updated_at::text, created_at::text
    `,
    [
      input.prospectId,
      input.actorUserId,
      input.gmailThreadId ?? null,
      input.inReplyToRfcMessageId ?? null,
      input.replyToGmailMessageId ?? null,
      input.toAddresses,
      input.ccAddresses,
      input.subject,
      input.bodyText,
    ],
  );
  return created.rows[0];
}

export async function discardProspectEmailDraft(
  client: PoolClient,
  prospectId: string,
  draftId: string,
) {
  const deleted = await client.query(
    `
      DELETE FROM crm.email_drafts
      WHERE id = $1::uuid AND prospect_id = $2::uuid AND sent_at IS NULL
    `,
    [draftId, prospectId],
  );
  if (!deleted.rowCount) throw new Error("That draft was not found.");
}

export async function markProspectEmailDraftSent(
  client: PoolClient,
  input: { prospectId: string; draftId: string; gmailMessageId: string },
) {
  const updated = await client.query(
    `
      UPDATE crm.email_drafts
      SET sent_at = now(),
          sent_gmail_message_id = $3,
          updated_at = now()
      WHERE id = $1::uuid AND prospect_id = $2::uuid AND sent_at IS NULL
    `,
    [input.draftId, input.prospectId, input.gmailMessageId],
  );
  if (!updated.rowCount) throw new Error("That draft was not found.");
}

export type EmailSendBlock = {
  allowed: false;
  error: string;
  warning?: string;
};

export type EmailSendReady = {
  allowed: true;
  warning?: string;
  toAddresses: string[];
  ccAddresses: string[];
  subject: string;
  bodyText: string;
  gmailThreadId: string | null;
  inReplyToRfcMessageId: string | null;
  replyToGmailMessageId: string | null;
};

export async function prepareProspectEmailSend(
  client: PoolClient,
  input: EmailComposeInput & { prospectId: string },
): Promise<EmailSendBlock | EmailSendReady> {
  const toAddresses = uniqueNormalizedEmails(input.toAddresses);
  const ccAddresses = uniqueNormalizedEmails(input.ccAddresses).filter(
    (email) => !toAddresses.includes(email),
  );
  const allRecipients = [...toAddresses, ...ccAddresses];
  if (!toAddresses.length) {
    return { allowed: false, error: "Add at least one recipient before sending." };
  }

  const prospect = await client.query<{
    do_not_contact: boolean;
    archived_at: string | null;
  }>(
    `
      SELECT queue.do_not_contact, prospect.archived_at::text
      FROM crm.prospects prospect
      JOIN crm.prospect_work_queue queue ON queue.prospect_id = prospect.id
      WHERE prospect.id = $1::uuid
    `,
    [input.prospectId],
  );
  const row = prospect.rows[0];
  if (!row) return { allowed: false, error: "That lead was not found." };
  if (row.archived_at) {
    return { allowed: false, error: "This lead is archived." };
  }
  if (row.do_not_contact) {
    return { allowed: false, error: "This lead is marked Do Not Contact." };
  }

  const contacts = await client.query<{
    raw_value: string;
    status: string;
  }>(
    `
      SELECT raw_value, status::text
      FROM crm.contact_methods
      WHERE prospect_id = $1::uuid AND type = 'email'
    `,
    [input.prospectId],
  );
  const optedOut = new Set(
    contacts.rows
      .filter((contact) => contact.status === "opted_out")
      .map((contact) => normalizeEmail(contact.raw_value)),
  );
  const blockedOptOut = allRecipients.find((email) => optedOut.has(email));
  if (blockedOptOut) {
    return {
      allowed: false,
      error: `${blockedOptOut} is marked opted out on this lead.`,
    };
  }

  const blacklist = await listEmailBlacklist(client);
  const blocked = allRecipients.find((email) => emailMatchesBlacklist(email, blacklist));
  if (blocked) {
    return {
      allowed: false,
      error: `${blocked} is on the email blacklist.`,
    };
  }

  return {
    allowed: true,
    toAddresses,
    ccAddresses,
    subject: input.subject.trim(),
    bodyText: input.bodyText,
    gmailThreadId: input.gmailThreadId?.trim() || null,
    inReplyToRfcMessageId: input.inReplyToRfcMessageId?.trim() || null,
    replyToGmailMessageId: input.replyToGmailMessageId?.trim() || null,
  };
}

export function composeWarningForDraft(input: {
  doNotContact: boolean;
  toAddresses: string[];
}) {
  if (input.doNotContact) {
    return "This lead is marked Do Not Contact. You can save a draft, but sending is blocked.";
  }
  if (!input.toAddresses.length) {
    return "Add a recipient before sending.";
  }
  return null;
}

export { replySubject };
