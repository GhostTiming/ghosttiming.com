import { GMAIL_BODY_MAX_CHARS } from "./scopes";
import { parseAddressList, uniqueNormalizedEmails } from "./email-match";

export type GmailHeader = { name?: string; value?: string };
export type GmailPayload = {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number };
  parts?: GmailPayload[];
};

export type GmailMessage = {
  id?: string;
  threadId?: string;
  snippet?: string;
  internalDate?: string;
  payload?: GmailPayload;
};

export type CanonicalGmailMessage = {
  gmailMessageId: string;
  gmailThreadId: string | null;
  rfcMessageId: string | null;
  direction: "incoming" | "outgoing";
  fromAddress: string | null;
  fromName: string | null;
  toAddresses: string[];
  ccAddresses: string[];
  subject: string | null;
  snippet: string | null;
  bodyText: string | null;
  occurredAt: string;
  involvedEmails: string[];
};

function headerValue(headers: GmailHeader[] | undefined, name: string) {
  return (
    headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())
      ?.value ?? null
  );
}

function decodeBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const remainder = padded.length % 4;
  const withPadding = remainder ? padded + "=".repeat(4 - remainder) : padded;
  if (typeof atob === "function") {
    try {
      const binary = atob(withPadding);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    } catch {
      return null;
    }
  }
  return Buffer.from(withPadding, "base64").toString("utf8");
}

function stripHtml(value: string) {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function collectBodies(payload: GmailPayload | undefined, acc: { text?: string; html?: string }) {
  if (!payload) return acc;
  const mime = payload.mimeType ?? "";
  if (payload.body?.data) {
    const decoded = decodeBase64Url(payload.body.data);
    if (decoded) {
      if (mime.startsWith("text/plain") && !acc.text) acc.text = decoded;
      if (mime.startsWith("text/html") && !acc.html) acc.html = decoded;
    }
  }
  for (const part of payload.parts ?? []) collectBodies(part, acc);
  return acc;
}

function truncateBody(value: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length <= GMAIL_BODY_MAX_CHARS) return trimmed;
  return `${trimmed.slice(0, GMAIL_BODY_MAX_CHARS)}\n\n[Truncated]`;
}

export function parseGmailMessage(
  message: GmailMessage,
  connectedEmail: string,
): CanonicalGmailMessage | null {
  const gmailMessageId = message.id?.trim();
  if (!gmailMessageId) return null;
  const headers = message.payload?.headers ?? [];
  const from = parseAddressList(headerValue(headers, "from"))[0] ?? null;
  const to = parseAddressList(headerValue(headers, "to"));
  const cc = parseAddressList(headerValue(headers, "cc"));
  const connected = connectedEmail.trim().toLowerCase();
  const direction =
    from?.email === connected ? ("outgoing" as const) : ("incoming" as const);
  const bodies = collectBodies(message.payload, {});
  const bodyText = truncateBody(bodies.text ?? (bodies.html ? stripHtml(bodies.html) : null));
  const occurredMs = Number(message.internalDate ?? Date.now());
  const involvedEmails = uniqueNormalizedEmails(
    from?.email,
    to.map((address) => address.email),
    cc.map((address) => address.email),
  );
  return {
    gmailMessageId,
    gmailThreadId: message.threadId ?? null,
    rfcMessageId: headerValue(headers, "message-id"),
    direction,
    fromAddress: from?.email ?? null,
    fromName: from?.name ?? null,
    toAddresses: to.map((address) => address.email),
    ccAddresses: cc.map((address) => address.email),
    subject: headerValue(headers, "subject"),
    snippet: message.snippet?.trim() || null,
    bodyText,
    occurredAt: new Date(Number.isFinite(occurredMs) ? occurredMs : Date.now()).toISOString(),
    involvedEmails,
  };
}

export function formatGmailActivityBody(
  message: Omit<CanonicalGmailMessage, "involvedEmails">,
) {
  const lines = [
    message.subject ? `Subject: ${message.subject}` : "Subject: (none)",
    message.fromAddress
      ? `From: ${message.fromName ? `${message.fromName} <${message.fromAddress}>` : message.fromAddress}`
      : null,
    message.toAddresses.length ? `To: ${message.toAddresses.join(", ")}` : null,
    message.ccAddresses.length ? `Cc: ${message.ccAddresses.join(", ")}` : null,
    "",
    message.bodyText || message.snippet || "(No message body stored)",
  ];
  return lines.filter((line) => line !== null).join("\n");
}
