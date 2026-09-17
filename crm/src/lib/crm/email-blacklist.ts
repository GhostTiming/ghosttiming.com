import type { PoolClient } from "pg";
import { normalizeEmail } from "../contact-extraction/extract";
import { liveBookingOwnsListingSql } from "./catalog-link";
import {
  parseDisqualifiedDetails,
  type DisqualifiedReason,
  type OutcomeReasonDetails,
} from "./domain";
import { changeProspectStage, closeCandidateListing } from "./mutations";

export type BlacklistMatchKind = "email" | "domain";

export type BlacklistEntry = {
  id: string;
  pattern: string;
  matchKind: BlacklistMatchKind;
  reason: DisqualifiedReason;
  note: string | null;
  createdAt: string;
  createdByName: string | null;
};

const EMAIL_PATTERN =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const DOMAIN_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export function parseBlacklistPattern(raw: string) {
  const value = normalizeEmail(raw).replace(/^@+/, "");
  if (!value) {
    return { success: false as const, error: "Enter an email address or @domain.com." };
  }
  if (value.includes("@")) {
    if (!EMAIL_PATTERN.test(value)) {
      return { success: false as const, error: "Enter a valid email address." };
    }
    return { success: true as const, pattern: value, matchKind: "email" as const };
  }
  if (!DOMAIN_PATTERN.test(value)) {
    return {
      success: false as const,
      error: "Enter a full email, or a domain like @racecompany.com.",
    };
  }
  return { success: true as const, pattern: value, matchKind: "domain" as const };
}

export function emailMatchesBlacklist(
  email: string,
  entries: Array<{ pattern: string; matchKind: BlacklistMatchKind }>,
) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  return entries.some((entry) =>
    entry.matchKind === "email"
      ? normalized === entry.pattern
      : normalized.endsWith(`@${entry.pattern}`),
  );
}

export function formatBlacklistPattern(entry: {
  pattern: string;
  matchKind: BlacklistMatchKind;
}) {
  return entry.matchKind === "domain" ? `@${entry.pattern}` : entry.pattern;
}

type BlacklistActor = { id: string; name: string };

export async function listEmailBlacklist(client: {
  query: PoolClient["query"];
}) {
  const result = await client.query<BlacklistEntry>(
    `
      SELECT
        entry.id::text,
        entry.pattern,
        entry.match_kind AS "matchKind",
        entry.reason,
        entry.note,
        entry.created_at::text AS "createdAt",
        created_by.name AS "createdByName"
      FROM crm.prospect_email_blacklist entry
      LEFT JOIN crm.users created_by ON created_by.id = entry.created_by_user_id
      ORDER BY entry.pattern
    `,
  );
  return result.rows;
}

export async function applyEmailBlacklist(
  client: PoolClient,
  actor: BlacklistActor,
  options: { listingIds?: string[] } = {},
) {
  const count = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM crm.prospect_email_blacklist`,
  );
  if (Number(count.rows[0]?.n ?? 0) === 0) {
    return { closed: 0, matched: 0 };
  }

  const matches = await client.query<{
    listing_id: string | null;
    prospect_id: string | null;
    pattern: string;
    reason: string;
    note: string | null;
    matched_email: string;
  }>(
    `
      WITH matched AS (
        SELECT
          cm.race_listing_id AS listing_id,
          cm.prospect_id,
          bl.pattern,
          bl.reason,
          bl.note,
          lower(btrim(cm.normalized_value)) AS matched_email,
          CASE WHEN bl.match_kind = 'email' THEN 0 ELSE 1 END AS specificity
        FROM crm.contact_methods cm
        LEFT JOIN crm.prospects matched_prospect ON matched_prospect.id = cm.prospect_id
        JOIN crm.prospect_email_blacklist bl
          ON cm.type = 'email'
         AND cm.status <> 'invalid'
         AND (
           (bl.match_kind = 'email' AND lower(btrim(cm.normalized_value)) = bl.pattern)
           OR (
             bl.match_kind = 'domain'
             AND lower(btrim(cm.normalized_value)) LIKE '%@' || bl.pattern
           )
         )
        WHERE matched_prospect.id IS NULL OR matched_prospect.archived_at IS NULL
        UNION ALL
        SELECT
          prospect.race_listing_id,
          prospect.id,
          bl.pattern,
          bl.reason,
          bl.note,
          lower(btrim(person.email)),
          CASE WHEN bl.match_kind = 'email' THEN 0 ELSE 1 END
        FROM crm.prospects prospect
        JOIN crm.people person ON person.id = prospect.primary_contact_person_id
        JOIN crm.prospect_email_blacklist bl
          ON person.email IS NOT NULL
         AND btrim(person.email) <> ''
         AND (
           (bl.match_kind = 'email' AND lower(btrim(person.email)) = bl.pattern)
           OR (
             bl.match_kind = 'domain'
             AND lower(btrim(person.email)) LIKE '%@' || bl.pattern
           )
         )
        WHERE prospect.archived_at IS NULL
      )
      SELECT DISTINCT ON (COALESCE(prospect_id::text, listing_id))
        listing_id,
        prospect_id::text,
        pattern,
        reason,
        note,
        matched_email
      FROM matched
      WHERE ($1::text[] IS NULL OR listing_id = ANY($1::text[]))
        AND (
          listing_id IS NULL
          OR NOT ${liveBookingOwnsListingSql("listing_id")}
        )
      ORDER BY COALESCE(prospect_id::text, listing_id), specificity, pattern
    `,
    [options.listingIds?.length ? options.listingIds : null],
  );

  let closed = 0;
  const seen = new Set<string>();
  for (const row of matches.rows) {
    const key = row.prospect_id ?? row.listing_id;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    try {
      await client.query("SAVEPOINT email_blacklist_row");
      const details = parseDisqualifiedDetails({
        reason: row.reason,
        note:
          row.note ||
          `Matched blacklist ${row.pattern} (${row.matched_email})`,
      });
      const didClose = await closeMatchedLead(client, actor, {
        listingId: row.listing_id,
        prospectId: row.prospect_id,
        details,
      });
      if (didClose) closed += 1;
      await client.query("RELEASE SAVEPOINT email_blacklist_row");
    } catch {
      await client.query("ROLLBACK TO SAVEPOINT email_blacklist_row");
    }
  }
  return { closed, matched: matches.rows.length };
}

async function closeMatchedLead(
  client: PoolClient,
  actor: BlacklistActor,
  input: {
    listingId: string | null;
    prospectId: string | null;
    details: OutcomeReasonDetails;
  },
) {
  const stageActor = {
    actorType: "system" as const,
    actorUserId: actor.id,
    actorName: "Email blacklist",
  };
  if (input.prospectId) {
    const current = await client.query<{
      key: string;
      archived_at: string | null;
      converted_booking_id: string | null;
    }>(
      `
        SELECT stage.key, prospect.archived_at::text, prospect.converted_booking_id::text
        FROM crm.prospects prospect
        JOIN crm.pipeline_stages stage ON stage.id = prospect.stage_id
        WHERE prospect.id = $1::uuid
      `,
      [input.prospectId],
    );
    const row = current.rows[0];
    if (
      !row ||
      row.archived_at ||
      row.converted_booking_id ||
      row.key === "closed_lost" ||
      row.key === "unqualified" ||
      row.key === "past_event" ||
      row.key === "confirmed"
    ) {
      return false;
    }
    return changeProspectStage(
      client,
      input.prospectId,
      "disqualified",
      stageActor,
      null,
      { disqualified: input.details },
    );
  }
  if (!input.listingId) return false;
  const existing = await client.query<{ id: string; key: string }>(
    `
      SELECT prospect.id::text, stage.key
      FROM crm.prospects prospect
      JOIN crm.pipeline_stages stage ON stage.id = prospect.stage_id
      WHERE prospect.race_listing_id = $1
        AND prospect.archived_at IS NULL
      ORDER BY prospect.created_at DESC
      LIMIT 1
    `,
    [input.listingId],
  );
  if (existing.rows[0]) {
    return closeMatchedLead(client, actor, {
      listingId: input.listingId,
      prospectId: existing.rows[0].id,
      details: input.details,
    });
  }
  await closeCandidateListing(client, {
    raceListingId: input.listingId,
    userId: actor.id,
    userName: actor.name,
    stageKey: "disqualified",
    reason: input.details.reason,
    note: input.details.note,
    actorType: "system",
    actorName: "Email blacklist",
  });
  return true;
}
