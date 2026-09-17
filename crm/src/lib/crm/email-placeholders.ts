const BIGIN_FIELD_ALIASES: Record<string, string> = {
  "event name": "event_name",
  "race registration site": "registration_url",
  "arr. time": "timer_online_at",
  "start/split/finish points": "course_points",
  "event distance(s)/start time(s)": "distances_and_start_times",
  "awards and age groups per event": "awards_and_age_groups",
  "event & point name": "event_name_to_program",
  "event &amp; point name": "event_name_to_program",
  "additional scoring/support expectations": "additional_expectations",
};

export type EmailTemplateValue = string | { html: string };

export const CREW_EMAIL_PLACEHOLDERS = [
  { key: "event_name", label: "Event name" },
  { key: "registration_url", label: "Registration website" },
  { key: "registration_link", label: "Registration website as a link" },
  { key: "timer_online_at", label: "When the timer will be online" },
  { key: "event_name_to_program", label: "Event name to program" },
  { key: "course_points", label: "Start / split / finish locations and point name to program" },
  { key: "distances_and_start_times", label: "Distances and start times" },
  { key: "awards_and_age_groups", label: "Awards and age groups" },
  { key: "additional_expectations", label: "Additional expectations" },
  { key: "timer_name", label: "Timer name" },
  { key: "timer_phone", label: "Timer phone" },
  { key: "timer_phone_link", label: "Timer phone as a tel link" },
  { key: "timer_email", label: "Timer email" },
  { key: "organization_name", label: "Direct client / organization" },
  { key: "crew_notes_label", label: "Header label (remote vs on-site)" },
  { key: "logo_url", label: "Logo image URL" },
] as const;

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function resolveKey(raw: string) {
  const trimmed = raw.replace(/&amp;/g, "&").trim();
  const snake = trimmed.toLowerCase().replaceAll(" ", "_");
  if (/^[a-z][a-z0-9_]*$/.test(snake) && !snake.includes("__")) {
    const mapped = BIGIN_FIELD_ALIASES[trimmed.toLowerCase()];
    if (mapped) return mapped;
    return snake;
  }
  return BIGIN_FIELD_ALIASES[trimmed.toLowerCase()] ?? null;
}

function renderValue(value: EmailTemplateValue | undefined) {
  if (value == null) return "";
  if (typeof value === "object") return value.html;
  return escapeHtml(value);
}

export function applyEmailTemplate(
  template: string,
  values: Record<string, EmailTemplateValue>,
) {
  return template.replace(
    /\{\{\s*([a-z0-9_]+)\s*\}\}|\$\{Event Pipeline\.([^}]+)\}/gi,
    (match, snake: string | undefined, bigin: string | undefined) => {
      const key = resolveKey(snake ?? bigin ?? "");
      if (!key || !(key in values)) return match;
      return renderValue(values[key]);
    },
  );
}

export function htmlToPlainText(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h[1-6]|li|table)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
