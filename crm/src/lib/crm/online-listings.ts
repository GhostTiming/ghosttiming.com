import type { PoolClient } from "pg";
import { getPool } from "@/db";
import {
  asCatalogQuery,
  linkEventToCatalogListing,
  loadCatalogListingCandidates,
  unlinkEventFromCatalogListing,
  type CatalogListingCandidate,
} from "./catalog-link";
import type { OnlineListing } from "./online-listing-types";
import { eventMatchKey } from "./event-matching";
import {
  estimateRaceDurationMinutes,
  recalculateOccurrenceTimes,
  syncOccurrenceRacesFromCatalog,
} from "./race-operations";
import {
  currentRunSignupEvents,
  earliestRunSignupStart,
  fetchRunSignupRace,
  looksLikeEventUrl,
  parseRaceRosterUrl,
  parseRunSignupDistance,
  parseRunSignupListingId,
  parseRunSignupLocalDateTime,
  parseRunSignupUrl,
  runSignupListingId,
  searchRunSignupRaces,
  type RunSignupRace,
} from "./runsignup";
import { shouldSearchOnlineListings } from "./runsignup-parse";

export type { OnlineListing, OnlineListingSource } from "./online-listing-types";
export { shouldSearchOnlineListings };

export function isRunSignupListingId(listingId: string) {
  return Boolean(parseRunSignupListingId(listingId));
}

function asCatalogListing(row: CatalogListingCandidate): OnlineListing {
  return {
    ...row,
    source: "catalog",
    source_label: "Online catalog",
  };
}

function asRunSignupListing(race: RunSignupRace): OnlineListing {
  const start = earliestRunSignupStart(race);
  return {
    id: runSignupListingId(race.race_id),
    name: race.name,
    city: race.address?.city ?? null,
    state: race.address?.state ?? null,
    zipcode: race.address?.zipcode ?? null,
    next_start_at: start?.local ?? null,
    edition_year: start?.year ?? null,
    source: "runsignup",
    source_label: "RunSignUp",
    registration_url: race.url ?? race.external_race_url ?? null,
  };
}

type CatalogListingRow = CatalogListingCandidate & { slug?: string | null };

export async function findCatalogListingForRunSignup(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: CatalogListingRow[] }> },
  raceId: string,
  race?: RunSignupRace | null,
) {
  if (!/^\d{3,}$/.test(raceId)) return null;
  const likeId = `%-${raceId}`;
  const found = await client.query(
    `
      SELECT id, slug, name, city, state, zipcode, next_start_at::text,
             (
               SELECT MAX(edition_year)
               FROM catalog.race_editions
               WHERE race_listing_id = catalog.race_listings.id
             ) AS edition_year
      FROM catalog.race_listings
      WHERE id = $1
         OR slug = $1
         OR slug LIKE $2
         OR registration_url ~ ('(^|[^0-9])' || $1 || '([^0-9]|$)')
         OR external_race_url ~ ('(^|[^0-9])' || $1 || '([^0-9]|$)')
      ORDER BY
        CASE
          WHEN id = $1 OR slug = $1 OR slug LIKE $2 THEN 0
          ELSE 1
        END,
        next_start_at DESC NULLS LAST
      LIMIT 5
    `,
    [raceId, likeId],
  );
  const exact = found.rows.find((row) =>
    row.id === raceId ||
    row.id.endsWith(`-${raceId}`) ||
    Boolean(row.slug && (row.slug === raceId || row.slug.endsWith(`-${raceId}`))),
  );
  if (exact) return asCatalogListing(exact);
  if (found.rows.length === 1) return asCatalogListing(found.rows[0]);
  if (!race?.name) return null;
  const key = eventMatchKey(race.name);
  if (!key) return null;
  const named = await client.query(
    `
      SELECT id, name, city, state, zipcode, next_start_at::text,
             (
               SELECT MAX(edition_year)
               FROM catalog.race_editions
               WHERE race_listing_id = catalog.race_listings.id
             ) AS edition_year
      FROM catalog.race_listings
      WHERE btrim(regexp_replace(lower(name), '[^a-z0-9]+', ' ', 'g'))
        = btrim(regexp_replace(lower($1), '[^a-z0-9]+', ' ', 'g'))
      LIMIT 3
    `,
    [race.name],
  );
  return named.rows.length === 1 ? asCatalogListing(named.rows[0]) : null;
}

export async function searchOnlineListings(query: string): Promise<OnlineListing[]> {
  const search = query.trim();
  if (!shouldSearchOnlineListings(search)) return [];
  const rsuUrl = parseRunSignupUrl(search);
  const rosterUrl = parseRaceRosterUrl(search);
  const numericId = /^\d{3,}$/.test(search) ? search : undefined;
  const nameHint =
    rsuUrl?.nameHint ||
    rosterUrl?.nameHint ||
    (!looksLikeEventUrl(search) && !numericId ? search : "");
  const catalogSearch = nameHint;
  const catalog = catalogSearch
    ? await loadCatalogListingCandidates(
        asCatalogQuery((sql, params) => getPool().query(sql, params)),
        { search: catalogSearch },
      )
    : { listings: [] as CatalogListingCandidate[] };
  const catalogRows = catalog.listings.map(asCatalogListing);
  let races: RunSignupRace[] = [];
  try {
    const raceId = rsuUrl?.raceId || numericId;
    if (raceId) {
      const race = await fetchRunSignupRace(raceId);
      if (race) races = [race];
    } else if (nameHint.trim().length >= 3) {
      races = await searchRunSignupRaces(nameHint);
    }
  } catch {
    races = [];
  }

  const merged: OnlineListing[] = [...catalogRows];
  const seen = new Set(catalogRows.map((row) => row.id));
  const client = {
    query: (sql: string, params?: unknown[]) =>
      getPool().query<CatalogListingCandidate>(sql, params),
  };
  for (const race of races) {
    const existing = await findCatalogListingForRunSignup(
      client,
      String(race.race_id),
      race,
    );
    if (existing) {
      if (!seen.has(existing.id)) {
        seen.add(existing.id);
        merged.push(existing);
      }
      continue;
    }
    const listing = asRunSignupListing(race);
    if (seen.has(listing.id)) continue;
    seen.add(listing.id);
    merged.push(listing);
  }
  return merged.slice(0, 40);
}

export async function resolveOnlineListingId(listingId: string) {
  const raceId = parseRunSignupListingId(listingId);
  if (!raceId) return { kind: "catalog" as const, listingId };
  const race = await fetchRunSignupRace(raceId);
  if (!race) throw new Error("That RunSignUp race was not found.");
  const catalog = await findCatalogListingForRunSignup(getPool(), raceId, race);
  if (catalog) return { kind: "catalog" as const, listingId: catalog.id, race };
  return { kind: "runsignup" as const, listingId, race };
}

async function syncOccurrenceRacesFromRunSignup(
  client: PoolClient,
  occurrenceId: string,
  race: RunSignupRace,
  timezone: string,
) {
  const events = currentRunSignupEvents(race);
  let sortOrder = 0;
  for (const event of events) {
    const start = parseRunSignupLocalDateTime(event.start_time);
    const distance = parseRunSignupDistance(event.distance);
    const name = event.name?.trim() || distance.label || "Race";
    const duration = estimateRaceDurationMinutes(
      distance.label,
      distance.miles,
      distance.meters,
    );
    const existing = await client.query<{ id: string }>(
      `SELECT id::text
       FROM crm.occurrence_races
       WHERE occurrence_id = $1::uuid
         AND lower(name) = lower($2)
       ORDER BY sort_order, created_at
       LIMIT 1`,
      [occurrenceId, name],
    );
    if (existing.rows[0]) {
      await client.query(
        `UPDATE crm.occurrence_races
         SET distance_label = COALESCE($2, distance_label),
             distance_miles = COALESCE($3, distance_miles),
             distance_meters = COALESCE($4, distance_meters),
             start_time = CASE
               WHEN $5::text IS NOT NULL THEN $5::timestamp AT TIME ZONE $6
               ELSE start_time
             END,
             estimated_duration_minutes = COALESCE($7, estimated_duration_minutes),
             sort_order = $8,
             updated_at = now()
         WHERE id = $1::uuid`,
        [
          existing.rows[0].id,
          distance.label,
          distance.miles,
          distance.meters,
          start?.local ?? null,
          timezone,
          duration,
          sortOrder,
        ],
      );
    } else {
      await client.query(
        `INSERT INTO crm.occurrence_races
          (occurrence_id, name, distance_label, distance_miles, distance_meters,
           start_time, estimated_duration_minutes, sort_order)
         VALUES (
           $1::uuid, $2, $3, $4, $5,
           CASE WHEN $6::text IS NOT NULL THEN $6::timestamp AT TIME ZONE $7 ELSE NULL END,
           $8, $9
         )`,
        [
          occurrenceId,
          name,
          distance.label,
          distance.miles,
          distance.meters,
          start?.local ?? null,
          timezone,
          duration,
          sortOrder,
        ],
      );
    }
    sortOrder += 1;
  }
  await recalculateOccurrenceTimes(client, occurrenceId);
}

export async function applyRunSignupRaceToEvent(
  client: PoolClient,
  input: {
    eventId: string;
    occurrenceId: string;
    race: RunSignupRace;
  },
) {
  const timezone = input.race.timezone?.trim() || "America/New_York";
  const start = earliestRunSignupStart(input.race);
  const website = input.race.url ?? input.race.external_race_url ?? null;
  await client.query(
    `UPDATE crm.events
     SET name = $2,
         source_type = 'runsignup',
         external_source_id = $3,
         website = COALESCE($4, website),
         catalog_match_dismissed_at = NULL,
         updated_at = now()
     WHERE id = $1::uuid`,
    [input.eventId, input.race.name, String(input.race.race_id), website],
  );
  await client.query(
    `UPDATE crm.event_occurrences
     SET timezone = $2,
         registration_platform = 'runsignup',
         registration_url_override = COALESCE($3, registration_url_override),
         street_override = COALESCE(street_override, $4),
         street2_override = COALESCE(street2_override, $5),
         city_override = COALESCE(city_override, $6),
         state_override = COALESCE(state_override, $7),
         zipcode_override = COALESCE(zipcode_override, $8),
         occurrence_year = COALESCE($9, occurrence_year),
         race_date = CASE
           WHEN $10::text IS NOT NULL THEN $10::timestamp AT TIME ZONE $2
           ELSE race_date
         END,
         updated_at = now()
     WHERE id = $1::uuid`,
    [
      input.occurrenceId,
      timezone,
      website,
      input.race.address?.street ?? null,
      input.race.address?.street2 ?? null,
      input.race.address?.city ?? null,
      input.race.address?.state ?? null,
      input.race.address?.zipcode ?? null,
      start?.year ?? null,
      start?.local ?? null,
    ],
  );
  await syncOccurrenceRacesFromRunSignup(
    client,
    input.occurrenceId,
    input.race,
    timezone,
  );
}

export async function unlinkEventFromOnlineListing(
  client: PoolClient,
  eventId: string,
) {
  const current = await client.query<{
    catalog_race_listing_id: string | null;
    source_type: string;
  }>(
    `SELECT catalog_race_listing_id, source_type::text
     FROM crm.events
     WHERE id = $1::uuid`,
    [eventId],
  );
  const row = current.rows[0];
  if (!row) throw new Error("Event not found.");
  const hadCatalog = Boolean(row.catalog_race_listing_id);
  const hadRunSignup = row.source_type === "runsignup";
  if (!hadCatalog && !hadRunSignup) {
    throw new Error("This event is not linked to an online listing.");
  }
  if (hadCatalog) {
    await unlinkEventFromCatalogListing(client, eventId);
  }
  if (hadRunSignup) {
    await client.query(
      `UPDATE crm.events
       SET source_type = 'manual',
           external_source_id = NULL,
           updated_at = now()
       WHERE id = $1::uuid`,
      [eventId],
    );
    await client.query(
      `UPDATE crm.event_occurrences
       SET registration_platform = NULL, updated_at = now()
       WHERE event_id = $1::uuid
         AND registration_platform = 'runsignup'`,
      [eventId],
    );
  }
}

export async function refreshOccurrenceFromOnlineListing(
  client: PoolClient,
  input: { eventId: string; occurrenceId: string },
) {
  const current = await client.query<{
    listing_id: string | null;
    source_type: string;
    external_source_id: string | null;
  }>(
    `SELECT event.catalog_race_listing_id AS listing_id,
            event.source_type::text AS source_type,
            event.external_source_id
     FROM crm.events event
     JOIN crm.event_occurrences occurrence ON occurrence.event_id = event.id
     WHERE event.id = $1::uuid
       AND occurrence.id = $2::uuid`,
    [input.eventId, input.occurrenceId],
  );
  const row = current.rows[0];
  if (!row) throw new Error("Booking occurrence not found.");
  if (row.listing_id) {
    return syncOccurrenceRacesFromCatalog(client, input.occurrenceId);
  }
  if (row.source_type === "runsignup" && row.external_source_id) {
    const race = await fetchRunSignupRace(row.external_source_id);
    if (!race) throw new Error("That RunSignUp race was not found.");
    await applyRunSignupRaceToEvent(client, {
      eventId: input.eventId,
      occurrenceId: input.occurrenceId,
      race,
    });
    return { inserted: currentRunSignupEvents(race).length };
  }
  throw new Error("Match an online listing before re-syncing races.");
}

export async function linkEventToOnlineListing(
  client: PoolClient,
  input: {
    eventId: string;
    occurrenceId?: string | null;
    listingId: string;
    actor: { id: string; name: string };
    archiveProspects?: boolean;
  },
) {
  const resolved = await resolveOnlineListingId(input.listingId);
  if (resolved.kind === "catalog") {
    return linkEventToCatalogListing(client, {
      eventId: input.eventId,
      listingId: resolved.listingId,
      occurrenceId: input.occurrenceId,
      actor: input.actor,
      archiveProspects: input.archiveProspects,
    });
  }
  if (!input.occurrenceId) {
    const website = resolved.race.url ?? resolved.race.external_race_url ?? null;
    await client.query(
      `UPDATE crm.events
       SET name = $2,
           source_type = 'runsignup',
           external_source_id = $3,
           website = COALESCE($4, website),
           catalog_match_dismissed_at = NULL,
           updated_at = now()
       WHERE id = $1::uuid`,
      [
        input.eventId,
        resolved.race.name,
        String(resolved.race.race_id),
        website,
      ],
    );
    return { archivedCount: 0 };
  }
  await applyRunSignupRaceToEvent(client, {
    eventId: input.eventId,
    occurrenceId: input.occurrenceId,
    race: resolved.race,
  });
  return { archivedCount: 0 };
}
