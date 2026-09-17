import { normalizeEmail } from "../contact-extraction/extract";

export type ParsedAddress = {
  email: string;
  name: string | null;
};

export function parseAddressList(value: string | null | undefined): ParsedAddress[] {
  if (!value?.trim()) return [];
  const results: ParsedAddress[] = [];
  const seen = new Set<string>();
  const parts = value.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  for (const part of parts) {
    const angled = part.match(/^\s*(?:"([^"]*)"|([^<]*?))?\s*<([^>]+)>\s*$/);
    const rawEmail = angled ? angled[3] : part;
    const email = normalizeEmail(rawEmail.replace(/"/g, ""));
    if (!email.includes("@") || seen.has(email)) continue;
    seen.add(email);
    const name = angled ? (angled[1] || angled[2] || "").trim() || null : null;
    results.push({ email, name });
  }
  return results;
}

export function uniqueNormalizedEmails(
  ...groups: Array<string | null | undefined | Array<string | null | undefined>>
) {
  const emails = new Set<string>();
  for (const group of groups) {
    const values = Array.isArray(group) ? group : [group];
    for (const value of values) {
      if (!value) continue;
      const email = normalizeEmail(value);
      if (email.includes("@")) emails.add(email);
    }
  }
  return [...emails];
}

export type EmailMatchTargets = {
  prospectIds: string[];
  bookingIds: string[];
  organizationIds: string[];
  personIds: string[];
};

export function isClientOrganizationInboxEmail(
  email: string,
  organizationEmails: Iterable<string | null | undefined>,
) {
  const normalized = normalizeEmail(email);
  if (!normalized.includes("@")) return false;
  for (const organizationEmail of organizationEmails) {
    if (!organizationEmail?.trim()) continue;
    if (normalizeEmail(organizationEmail) === normalized) return true;
  }
  return false;
}

export function shouldLinkEmailToBooking(input: {
  email: string;
  organizationEmails?: Iterable<string | null | undefined>;
  matchedAsPrimaryContact: boolean;
  matchedAsConvertedLead: boolean;
}) {
  if (input.matchedAsConvertedLead) return true;
  if (!input.matchedAsPrimaryContact) return false;
  return !isClientOrganizationInboxEmail(
    input.email,
    input.organizationEmails ?? [],
  );
}

export function matchEmailsToCrm(
  addresses: string[],
  index: Record<string, EmailMatchTargets>,
): EmailMatchTargets {
  const prospectIds = new Set<string>();
  const bookingIds = new Set<string>();
  const organizationIds = new Set<string>();
  const personIds = new Set<string>();
  for (const address of addresses) {
    const match = index[normalizeEmail(address)];
    if (!match) continue;
    for (const id of match.prospectIds) prospectIds.add(id);
    for (const id of match.bookingIds) bookingIds.add(id);
    for (const id of match.organizationIds) organizationIds.add(id);
    for (const id of match.personIds) personIds.add(id);
  }
  return {
    prospectIds: [...prospectIds],
    bookingIds: [...bookingIds],
    organizationIds: [...organizationIds],
    personIds: [...personIds],
  };
}

export function emailsForGmailSearch(index: Record<string, EmailMatchTargets>) {
  return Object.entries(index)
    .filter(
      ([, targets]) =>
        targets.prospectIds.length > 0 ||
        targets.bookingIds.length > 0 ||
        targets.personIds.length > 0 ||
        targets.organizationIds.length > 0,
    )
    .map(([email]) => email);
}

export function buildGmailAddressQuery(emails: string[]) {
  const clauses = emails.map((email) => {
    const escaped = email.replace(/"/g, "");
    return `(from:${escaped} OR to:${escaped} OR cc:${escaped})`;
  });
  return `{${clauses.join(" OR ")}} -in:spam -in:trash`;
}

export function chunk<T>(items: T[], size: number) {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}
