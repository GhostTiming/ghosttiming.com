import { applyEmailTemplate, htmlToPlainText } from "./email-placeholders";
import { appendEmailSignature } from "./email-signature-html";

export const CADENCE_TEMPLATE_KIND = "cadence";
export const DEFAULT_CADENCE_NAME = "Cold Outreach — 4 Touch";

export const CADENCE_SENDABLE_CONTACT_STATUSES = ["valid", "unknown"] as const;

export function cadenceSendableContactStatusSql(alias = "method") {
  const values = CADENCE_SENDABLE_CONTACT_STATUSES.map((status) => `'${status}'`).join(", ");
  return `${alias}.status IN (${values})`;
}

export const ONSITE_FIRST_STATES = new Set(["FL"]);
export const REMOTE_OR_ONSITE_STATES = new Set(["GA", "AL", "SC", "NC", "TN"]);

const STATE_NAMES: Record<string, string> = {
  FLORIDA: "FL",
  GEORGIA: "GA",
  ALABAMA: "AL",
  "SOUTH CAROLINA": "SC",
  "NORTH CAROLINA": "NC",
  TENNESSEE: "TN",
};

export function normalizeUsState(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "";
  const upper = trimmed.toUpperCase();
  if (upper.length === 2) return upper;
  return STATE_NAMES[upper] ?? upper;
}

export function greetingLine(firstName: string | null | undefined) {
  const name = firstName?.trim();
  return name ? `Hi ${name},` : "Hey there,";
}

export function timingModeLine(state: string | null | undefined) {
  const code = normalizeUsState(state);
  if (ONSITE_FIRST_STATES.has(code)) return "on-site or remote timing";
  if (REMOTE_OR_ONSITE_STATES.has(code)) return "remote or on-site timing";
  return "remote timing";
}

export function isAutomaticReply(input: {
  subject?: string | null;
  fromAddress?: string | null;
  snippet?: string | null;
  bodyText?: string | null;
}) {
  const subject = input.subject?.trim() ?? "";
  const from = input.fromAddress?.trim().toLowerCase() ?? "";
  const body = `${input.snippet ?? ""}\n${input.bodyText ?? ""}`;
  if (/^automatic reply\s*:/i.test(subject)) return true;
  if (/out[\s-]?of[\s-]?office/i.test(subject)) return true;
  if (/delivery status notification/i.test(subject)) return true;
  if (/^undeliverable\b/i.test(subject)) return true;
  if (from.startsWith("mailer-daemon@")) return true;
  if (/^postmaster@/i.test(from)) return true;
  if (/out[\s-]?of[\s-]?office/i.test(body) && /automatic reply/i.test(subject + body)) {
    return true;
  }
  return false;
}

export type CadenceRow = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  step_count: number;
};

export type CadenceEnrollmentSummary = {
  id: string;
  cadence_id: string;
  cadence_name: string;
  status: string;
  current_step_order: number | null;
  step_count: number;
  enrolled_at: string;
  exited_at: string | null;
  exited_reason: string | null;
  next_step_order: number | null;
  next_scheduled_for: string | null;
};

export type PendingCadenceSend = {
  send_id: string;
  enrollment_id: string;
  prospect_id: string;
  race_name: string;
  cadence_name: string;
  step_order: number;
  step_count: number;
  scheduled_for: string;
  subject: string;
  body_html: string;
  to_addresses: string[];
};

export function cadenceStepLabel(stepOrder: number, stepCount: number) {
  return `Touch ${stepOrder} of ${stepCount}`;
}

export function addOffsetDays(from: Date, offsetDays: number) {
  const next = new Date(from.getTime());
  next.setUTCDate(next.getUTCDate() + offsetDays);
  return next;
}

export function replaceCadenceEndDashes(value: string) {
  return value
    .replace(/&mdash;|&#8212;|&#x2014;/gi, "-")
    .replace(/&ndash;|&#8211;|&#x2013;/gi, "-")
    .replace(/[\u2014\u2013]/g, "-");
}

export function renderCadenceTemplate(input: {
  subject: string;
  bodyHtml: string;
  greetingLine: string;
  eventName: string;
  timingModeLine: string;
  signatureHtml?: string | null;
}) {
  const escaped = {
    greeting_line: input.greetingLine,
    event_name: input.eventName,
    timing_mode_line: input.timingModeLine,
  };
  const unescaped = {
    greeting_line: { html: input.greetingLine },
    event_name: { html: input.eventName },
    timing_mode_line: { html: input.timingModeLine },
  };
  const subject = replaceCadenceEndDashes(
    applyEmailTemplate(input.subject, unescaped).trim(),
  );
  const bodyHtml = replaceCadenceEndDashes(applyEmailTemplate(input.bodyHtml, escaped));
  const composed = appendEmailSignature({
    bodyHtml,
    bodyText: htmlToPlainText(bodyHtml),
    signatureHtml: input.signatureHtml,
    htmlSeparator: "<br />",
    textSeparator: "\n",
  });
  return {
    subject,
    bodyHtml: composed.html ?? bodyHtml,
    bodyText: composed.text,
  };
}

