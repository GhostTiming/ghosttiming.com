export type ExtractedContact = {
  type: "email" | "phone";
  rawValue: string;
  normalizedValue: string;
  label?: string;
  sourceField: "description_html";
};

const emailPattern =
  /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/gi;
const phonePattern =
  /(?:\+?1[\s.-]?)?(?:\(\s*\d{3}\s*\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?:\s*(?:x|ext\.?|extension)\s*\d{1,6})?/gi;

function decodeCommonHtml(value: string) {
  return value
    .replace(/&#64;|&#x40;|&commat;/gi, "@")
    .replace(/&#46;|&#x2e;/gi, ".")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function visibleText(html: string) {
  return decodeCommonHtml(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

function inferLabel(source: string, matchIndex: number, matchLength: number) {
  const context = source
    .slice(Math.max(0, matchIndex - 100), matchIndex + matchLength + 100)
    .toLowerCase();
  if (context.includes("race director")) return "Race Director";
  if (context.includes("sponsor")) return "Sponsorship";
  if (context.includes("registration")) return "Registration";
  if (context.includes("volunteer")) return "Volunteer";
  if (context.includes("contact")) return "Contact";
  if (context.includes("info")) return "General Information";
  return undefined;
}

export function normalizeEmail(rawValue: string) {
  return rawValue
    .replace(/^mailto:/i, "")
    .trim()
    .replace(/[),.;:]+$/g, "")
    .toLowerCase();
}

export function normalizePhone(rawValue: string) {
  const withoutExtension = rawValue.replace(
    /\s*(?:x|ext\.?|extension)\s*\d{1,6}\s*$/i,
    "",
  );
  const digits = withoutExtension.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return rawValue.trim().startsWith("+") ? `+${digits}` : digits;
}

export function extractContacts(descriptionHtml: string): ExtractedContact[] {
  const decodedHtml = decodeCommonHtml(descriptionHtml);
  const text = visibleText(descriptionHtml);
  const results = new Map<string, ExtractedContact>();

  for (const source of [decodedHtml, text]) {
    for (const match of source.matchAll(emailPattern)) {
      const rawValue = match[0].replace(/[),.;:]+$/g, "");
      const normalizedValue = normalizeEmail(rawValue);
      const key = `email:${normalizedValue}`;
      if (!results.has(key)) {
        results.set(key, {
          type: "email",
          rawValue,
          normalizedValue,
          label: inferLabel(source, match.index ?? 0, match[0].length),
          sourceField: "description_html",
        });
      }
    }

    for (const match of source.matchAll(phonePattern)) {
      const rawValue = match[0].trim();
      const normalizedValue = normalizePhone(rawValue);
      const key = `phone:${normalizedValue}`;
      if (!results.has(key)) {
        results.set(key, {
          type: "phone",
          rawValue,
          normalizedValue,
          label: inferLabel(source, match.index ?? 0, match[0].length),
          sourceField: "description_html",
        });
      }
    }
  }

  return [...results.values()];
}
