import type { PoolClient } from "pg";
import { appendAuditActivity } from "./audit";
import {
  catalogListingSearchIdWhereSql,
  catalogListingSearchWhereSql,
  catalogSearchIdNeedle,
  catalogSearchLikeNeedles,
  listingMatchesSearch,
} from "./catalog-search";
import { eventMatchKey, isGenericEventName, calendarDateInZone } from "./event-matching";
import {
  preferredCatalogEditionSql,
  syncOccurrenceRacesFromCatalog,
} from "./race-operations";

type CatalogCandidate = { id: string; name: string };
type EventCandidate = {
  id: string;
  name: string;
  catalog_race_listing_id: string | null;
};

export const ARCHIVED_BECAUSE_BOOKING =
  "Archived because this race is already a booking.";

const NAME_STOP_WORDS = new Set([
  "the",
  "and",
  "of",
  "a",
  "an",
  "at",
  "in",
  "for",
  "to",
  "by",
  "on",
]);

export type CatalogListingCandidate = {
  id: string;
  name: string;
  slug?: string | null;
  source_race_id?: string | number | null;
  source_event_ids?: string[] | null;
  city: string | null;
  state: string | null;
  zipcode?: string | null;
  next_start_at?: string | Date | null;
  edition_year?: number | null;
  /** True when a live booking already owns this listing (prospect links do not count). */
  taken?: boolean;
};

export type CatalogListingSuggestion = CatalogListingCandidate & {
  score: number;
  reason: "exact" | "similar";
};

type QueryFn = <T>(
  sql: string,
  params?: unknown[],
) => Promise<{ rows: T[] }>;

export function asCatalogQuery(
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>,
): QueryFn {
  return async <T>(sql: string, params?: unknown[]) => {
    const result = await query(sql, params);
    return { rows: result.rows as T[] };
  };
}

export function liveBookingOwnsListingSql(listingIdExpr: string) {
  return `EXISTS (
    SELECT 1
    FROM crm.events booked_event
    JOIN crm.event_occurrences booked_occurrence
      ON booked_occurrence.event_id = booked_event.id
    JOIN crm.bookings booked ON booked.occurrence_id = booked_occurrence.id
    JOIN crm.pipeline_stages booked_stage ON booked_stage.id = booked.stage_id
    WHERE booked_event.catalog_race_listing_id = ${listingIdExpr}
      AND booked_event.archived_at IS NULL
      AND booked.archived_at IS NULL
      AND booked_stage.key <> 'closed_lost'
  )`;
}

/** Listings already claimed by a live booking (not prospect-only links). */
export function liveBookedCatalogListingIdsSql() {
  return `SELECT DISTINCT event.catalog_race_listing_id AS id
     FROM crm.events event
     JOIN crm.event_occurrences occurrence ON occurrence.event_id = event.id
     JOIN crm.bookings booking ON booking.occurrence_id = occurrence.id
     JOIN crm.pipeline_stages stage ON stage.id = booking.stage_id
     WHERE event.catalog_race_listing_id IS NOT NULL
       AND event.archived_at IS NULL
       AND booking.archived_at IS NULL
       AND stage.key <> 'closed_lost'`;
}

export function liveBookingOwnsEventSql(eventIdExpr: string) {
  return `EXISTS (
    SELECT 1
    FROM crm.event_occurrences booked_occurrence
    JOIN crm.bookings booked ON booked.occurrence_id = booked_occurrence.id
    JOIN crm.pipeline_stages booked_stage ON booked_stage.id = booked.stage_id
    WHERE booked_occurrence.event_id = ${eventIdExpr}
      AND booked.archived_at IS NULL
      AND booked_stage.key <> 'closed_lost'
  )`;
}

export function listingHasGrvContactFlagSql(listingIdExpr: string) {
  return `EXISTS (
    SELECT 1
    FROM catalog.race_listing_regex_tags tag
    WHERE tag.race_listing_id = ${listingIdExpr}
      AND tag.tag_namespace = 'lead_contact'
      AND tag.tag_key IN ('description_has_email', 'description_has_phone')
      AND tag.tag_value = 'true'
  )`;
}

export function candidateHasUsableContactSql(
  phoneExpr: string,
  emailExpr: string,
  contactProcessedExpr: string,
) {
  return `(
    ${phoneExpr} IS NOT NULL
    OR ${emailExpr} IS NOT NULL
    OR NOT ${contactProcessedExpr}
  )`;
}

export function uniqueCatalogMatch(
  eventName: string,
  listingsByKey: Map<string, CatalogCandidate[]>,
) {
  if (!eventName || isGenericEventName(eventName)) return null;
  const matches = listingsByKey.get(eventMatchKey(eventName)) ?? [];
  return matches.length === 1 ? matches[0] : null;
}

export function uniqueCatalogMatchForEvent(
  event: {
    name: string;
    city?: string | null;
    state?: string | null;
    raceDate?: Date | string | null;
  },
  listings: CatalogListingCandidate[],
  takenIds: Iterable<string> = [],
) {
  if (!event.name || isGenericEventName(event.name)) return null;
  const taken = new Set(takenIds);
  const key = eventMatchKey(event.name);
  const matches = listings.filter(
    (listing) => !taken.has(listing.id) && eventMatchKey(listing.name) === key,
  );
  if (matches.length === 1) return matches[0];
  if (matches.length < 2) return null;

  const eventDate = calendarDateInZone(event.raceDate);
  if (eventDate) {
    const sameDay = matches.filter(
      (listing) => calendarDateInZone(listing.next_start_at) === eventDate,
    );
    if (sameDay.length === 1) return sameDay[0];
  }

  const eventState = event.state?.trim().toUpperCase() || "";
  if (eventState) {
    const sameState = matches.filter(
      (listing) => listing.state?.trim().toUpperCase() === eventState,
    );
    if (sameState.length === 1) return sameState[0];
    const eventCity = event.city?.trim().toLowerCase() || "";
    if (eventCity) {
      const sameCity = sameState.filter(
        (listing) => listing.city?.trim().toLowerCase() === eventCity,
      );
      if (sameCity.length === 1) return sameCity[0];
    }
  }

  const future = matches.filter((listing) => listing.next_start_at);
  return future.length === 1 ? future[0] : null;
}

export function nameTokens(name: string) {
  return eventMatchKey(name)
    .split(" ")
    .filter((token) => token.length >= 3 && !NAME_STOP_WORDS.has(token));
}

export function suggestCatalogMatches(
  event: { name: string; city?: string | null; state?: string | null },
  listings: CatalogListingCandidate[],
  options: { takenIds?: Iterable<string>; limit?: number } = {},
): CatalogListingSuggestion[] {
  if (!event.name || isGenericEventName(event.name)) return [];
  const eventKey = eventMatchKey(event.name);
  const eventTokens = nameTokens(event.name);
  const eventState = event.state?.trim().toUpperCase() || "";
  const eventCity = event.city?.trim().toLowerCase() || "";
  const taken = new Set(options.takenIds ?? []);
  const limit = options.limit ?? 5;
  const scored: CatalogListingSuggestion[] = [];

  for (const listing of listings) {
    if (taken.has(listing.id)) continue;
    const listingKey = eventMatchKey(listing.name);
    if (!listingKey) continue;
    if (eventKey && listingKey === eventKey) {
      scored.push({ ...listing, score: 100, reason: "exact" });
      continue;
    }
    const listingTokens = nameTokens(listing.name);
    if (!eventTokens.length || !listingTokens.length) continue;
    const listingSet = new Set(listingTokens);
    const overlap = eventTokens.filter((token) => listingSet.has(token));
    if (!overlap.length) continue;
    const union = new Set([...eventTokens, ...listingTokens]).size;
    let score = union ? (overlap.length / union) * 40 : 0;
    const listingState = listing.state?.trim().toUpperCase() || "";
    if (eventState && listingState && eventState === listingState) score += 15;
    const listingCity = listing.city?.trim().toLowerCase() || "";
    if (eventCity && listingCity && eventCity === listingCity) score += 10;
    if (overlap.length >= 2) score += 8;
    if (score < 24) continue;
    scored.push({ ...listing, score, reason: "similar" });
  }

  return scored
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, limit);
}

export function resolveCatalogListingQuery(
  query: string,
  listings: CatalogListingCandidate[],
  takenIds: Iterable<string> = [],
) {
  const needle = query.trim();
  if (!needle) return { matches: [] as CatalogListingCandidate[] };
  const taken = new Set(takenIds);
  const available = listings.filter((listing) => !taken.has(listing.id));
  const listingsByKey = new Map<string, CatalogCandidate[]>();
  for (const listing of available) {
    const key = eventMatchKey(listing.name);
    if (!key) continue;
    const current = listingsByKey.get(key) ?? [];
    current.push(listing);
    listingsByKey.set(key, current);
  }
  const unique = uniqueCatalogMatch(needle, listingsByKey);
  if (unique) {
    const listing = available.find((row) => row.id === unique.id);
    if (listing) return { match: listing };
  }
  const matches = available.filter((listing) =>
    listingMatchesSearch(listing, needle),
  );
  if (matches.length === 1) return { match: matches[0] };
  return { matches };
}

export async function listingOwnedByLiveBooking(
  query: QueryFn,
  listingId: string,
) {
  const result = await query<{ owned: boolean }>(
    `SELECT ${liveBookingOwnsListingSql("$1")} AS owned`,
    [listingId],
  );
  return result.rows[0]?.owned === true;
}

export async function listingVisibleInLeadPool(
  query: QueryFn,
  listingId: string,
) {
  const result = await query<{ visible: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM catalog.race_listings rl
       WHERE rl.id = $1
         AND (
           (
             rl.next_start_at >= now()
             AND ${listingHasGrvContactFlagSql("rl.id")}
             AND NOT ${liveBookingOwnsListingSql("rl.id")}
             AND NOT EXISTS (
               SELECT 1
               FROM crm.events linked_event
               JOIN crm.prospects linked_prospect
                 ON linked_prospect.event_id = linked_event.id
                AND linked_prospect.archived_at IS NULL
               WHERE linked_event.catalog_race_listing_id = rl.id
             )
           )
           OR (
             EXISTS (
               SELECT 1 FROM crm.prospects existing
               WHERE existing.race_listing_id = rl.id
                 AND existing.archived_at IS NULL
             )
             AND NOT ${liveBookingOwnsListingSql("rl.id")}
           )
         )
     ) AS visible`,
    [listingId],
  );
  return result.rows[0]?.visible === true;
}

const catalogNameMatchKeySql = `btrim(regexp_replace(
  regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(lower(name), '^\\s*20\\d{2}\\s+', ''),
          '\\s*[-–—]\\s*(renewal|new|timing lead)\\s*$',
          '',
          'i'
        ),
        '&', ' and ', 'g'
      ),
      '\\ythe\\y', ' ', 'g'
    ),
    '[^a-z0-9]+', ' ', 'g'
  ),
  '\\s+', ' ', 'g'
))`;

function listingYearSubselectSql(listingIdExpr = "catalog.race_listings.id") {
  return `(
    SELECT edition_year
    FROM catalog.race_editions
    WHERE race_listing_id = ${listingIdExpr}
    ORDER BY edition_year DESC NULLS LAST
    LIMIT 1
  )`;
}

const listingCandidateSelectSql = `SELECT id, name, slug, source_race_id::text,
          (
            SELECT coalesce(
              array_agg(DISTINCT source_event_id::text)
                FILTER (WHERE source_event_id IS NOT NULL),
              '{}'::text[]
            )
            FROM catalog.legacy_event_identity_map
            WHERE race_listing_id = catalog.race_listings.id
          ) AS source_event_ids,
          city, state, zipcode, next_start_at::text,
          ${listingYearSubselectSql()} AS edition_year
     FROM catalog.race_listings`;

export async function loadCatalogListingCandidates(
  query: QueryFn,
  options: { names?: string[]; search?: string } = {},
) {
  const search = options.search?.trim() ?? "";
  const keys = [
    ...new Set((options.names ?? []).map((name) => eventMatchKey(name)).filter(Boolean)),
  ];
  const idNeedle = catalogSearchIdNeedle(search);
  const searchNeedles = idNeedle ? [idNeedle] : catalogSearchLikeNeedles(search);
  const [listings, taken] = await Promise.all([
    searchNeedles.length
      ? query<CatalogListingCandidate>(
          `${listingCandidateSelectSql}
           WHERE ${
             idNeedle
               ? catalogListingSearchIdWhereSql()
               : catalogListingSearchWhereSql(searchNeedles.length)
           }
           ORDER BY next_start_at DESC NULLS LAST
           LIMIT 50`,
          searchNeedles,
        )
      : keys.length
        ? query<CatalogListingCandidate>(
            `${listingCandidateSelectSql}
             WHERE ${catalogNameMatchKeySql} = ANY($1::text[])`,
            [keys],
          )
        : Promise.resolve({ rows: [] as CatalogListingCandidate[] }),
    query<{ id: string }>(liveBookedCatalogListingIdsSql()),
  ]);
  const takenIds = new Set(taken.rows.map((row) => row.id));
  return {
    listings: listings.rows.map((listing) => ({
      ...listing,
      taken: takenIds.has(listing.id),
    })),
    takenIds,
  };
}

function listingsByMatchKey<T extends CatalogCandidate>(listings: T[]) {
  const listingsByKey = new Map<string, T[]>();
  for (const listing of listings) {
    const key = eventMatchKey(listing.name);
    if (!key) continue;
    const current = listingsByKey.get(key) ?? [];
    current.push(listing);
    listingsByKey.set(key, current);
  }
  return listingsByKey;
}

async function loadCatalogListingsForNames(
  client: PoolClient,
  names: string[],
) {
  const keys = [
    ...new Set(names.map((name) => eventMatchKey(name)).filter(Boolean)),
  ];
  if (!keys.length) return [] as CatalogListingCandidate[];
  const result = await client.query<CatalogListingCandidate>(
    `${listingCandidateSelectSql}
     WHERE ${catalogNameMatchKeySql} = ANY($1::text[])`,
    [keys],
  );
  return result.rows;
}

async function archiveProspectsByIds(
  client: PoolClient,
  prospectIds: string[],
  actor: { id: string; name: string },
  metadata: Record<string, unknown> = {},
) {
  if (!prospectIds.length) return 0;
  const archived = await client.query<{ id: string }>(
    `UPDATE crm.prospects
     SET archived_at = now(),
         archived_by_user_id = $2::uuid,
         updated_at = now()
     WHERE id = ANY($1::uuid[])
       AND archived_at IS NULL
     RETURNING id::text`,
    [prospectIds, actor.id],
  );
  for (const row of archived.rows) {
    await appendAuditActivity(
      client,
      { prospectId: row.id },
      actor,
      ARCHIVED_BECAUSE_BOOKING,
      { reason: "booking_catalog_match", ...metadata },
    );
  }
  return archived.rows.length;
}

export async function archiveProspectsForListing(
  client: PoolClient,
  listingId: string,
  actor: { id: string; name: string },
) {
  const matching = await client.query<{ id: string }>(
    `SELECT id::text
     FROM crm.prospects
     WHERE archived_at IS NULL
       AND (
         race_listing_id = $1
         OR event_id IN (
           SELECT id FROM crm.events WHERE catalog_race_listing_id = $1
         )
       )`,
    [listingId],
  );
  return archiveProspectsByIds(
    client,
    matching.rows.map((row) => row.id),
    actor,
    { raceListingId: listingId },
  );
}

export async function archiveProspectsOwnedByLiveBookings(
  client: PoolClient,
  actor: { id: string; name: string },
) {
  const matching = await client.query<{ id: string }>(
    `SELECT prospect.id::text
     FROM crm.prospects prospect
     WHERE prospect.archived_at IS NULL
       AND (
         ${liveBookingOwnsListingSql("prospect.race_listing_id")}
         OR EXISTS (
           SELECT 1
           FROM crm.events event
           WHERE event.id = prospect.event_id
             AND (
               ${liveBookingOwnsListingSql("event.catalog_race_listing_id")}
               OR ${liveBookingOwnsEventSql("event.id")}
             )
         )
       )`,
  );
  return archiveProspectsByIds(
    client,
    matching.rows.map((row) => row.id),
    actor,
    { reason: "live_booking" },
  );
}

export async function archiveUnmatchedProspectsForLiveBookedListings(
  client: PoolClient,
  actor: { id: string; name: string },
) {
  const booked = await client.query<CatalogListingCandidate>(
    `SELECT rl.id, rl.name, rl.slug, rl.city, rl.state, rl.next_start_at::text,
            ${listingYearSubselectSql("rl.id")} AS edition_year
     FROM catalog.race_listings rl
     WHERE ${liveBookingOwnsListingSql("rl.id")}`,
  );
  const prospects = await client.query<{
    id: string;
    name: string;
    city: string | null;
    state: string | null;
    race_date: Date | string | null;
  }>(
    `SELECT prospect.id::text, event.name,
            occurrence.city_override AS city,
            occurrence.state_override AS state,
            occurrence.race_date
     FROM crm.prospects prospect
     JOIN crm.events event ON event.id = prospect.event_id
     LEFT JOIN crm.event_occurrences occurrence
       ON occurrence.id = prospect.occurrence_id
     WHERE prospect.archived_at IS NULL
       AND prospect.race_listing_id IS NULL
       AND event.catalog_race_listing_id IS NULL
       AND event.catalog_match_dismissed_at IS NULL`,
  );
  const bookedIds = new Set(booked.rows.map((row) => row.id));
  const listingsByKey = listingsByMatchKey(booked.rows);
  const toArchive: string[] = [];
  for (const prospect of prospects.rows) {
    const named = listingsByKey.get(eventMatchKey(prospect.name)) ?? [];
    const match =
      named.length === 1
        ? named[0]
        : uniqueCatalogMatchForEvent(
            {
              name: prospect.name,
              city: prospect.city,
              state: prospect.state,
              raceDate: prospect.race_date,
            },
            named,
          );
    if (match && bookedIds.has(match.id)) toArchive.push(prospect.id);
  }
  return archiveProspectsByIds(client, toArchive, actor, {
    reason: "unique_name_matches_booked_listing",
  });
}

async function linkOccurrenceEditionIfUnique(
  client: PoolClient,
  occurrenceId: string,
  listingId: string,
) {
  const preferred = await client.query<{ id: string | null }>(
    `SELECT ${preferredCatalogEditionSql("$1")} AS id`,
    [listingId],
  );
  const editionId = preferred.rows[0]?.id;
  if (!editionId) return;
  await client.query(
    `UPDATE crm.event_occurrences
     SET catalog_race_edition_id = $2, updated_at = now()
     WHERE id = $1::uuid`,
    [occurrenceId, editionId],
  );
}

export async function linkEventToCatalogListing(
  client: PoolClient,
  input: {
    eventId: string;
    listingId: string;
    occurrenceId?: string | null;
    actor: { id: string; name: string };
    archiveProspects?: boolean;
  },
) {
  const ownedByOtherBooking = await client.query<{ owned: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM crm.events booked_event
       JOIN crm.event_occurrences booked_occurrence
         ON booked_occurrence.event_id = booked_event.id
       JOIN crm.bookings booked ON booked.occurrence_id = booked_occurrence.id
       JOIN crm.pipeline_stages booked_stage ON booked_stage.id = booked.stage_id
       WHERE booked_event.catalog_race_listing_id = $1
         AND booked_event.id <> $2::uuid
         AND booked_event.archived_at IS NULL
         AND booked.archived_at IS NULL
         AND booked_stage.key <> 'closed_lost'
     ) AS owned`,
    [input.listingId, input.eventId],
  );
  if (ownedByOtherBooking.rows[0]?.owned) {
    throw new Error(
      "That Get Run Vibes listing is already linked to another booking.",
    );
  }

  // Prospect (or other non-booking) events may already hold this listing.
  // Release them so the booking can claim it; prospects are archived below.
  const holders = await client.query<{ id: string }>(
    `SELECT id::text
     FROM crm.events
     WHERE catalog_race_listing_id = $1
       AND id <> $2::uuid
       AND archived_at IS NULL`,
    [input.listingId, input.eventId],
  );
  for (const holder of holders.rows) {
    await unlinkEventFromCatalogListing(client, holder.id);
  }

  const updated = await client.query(
    `UPDATE crm.events
     SET catalog_race_listing_id = $2,
         catalog_match_dismissed_at = NULL,
         updated_at = now()
     WHERE id = $1::uuid`,
    [input.eventId, input.listingId],
  );
  if (!updated.rowCount) throw new Error("Event not found.");

  const occurrences = input.occurrenceId
    ? [{ id: input.occurrenceId }]
    : (
        await client.query<{ id: string }>(
          `SELECT id::text FROM crm.event_occurrences WHERE event_id = $1::uuid`,
          [input.eventId],
        )
      ).rows;
  for (const occurrence of occurrences) {
    await linkOccurrenceEditionIfUnique(client, occurrence.id, input.listingId);
    await syncOccurrenceRacesFromCatalog(client, occurrence.id);
  }

  const archivedCount =
    input.archiveProspects === false
      ? 0
      : await archiveProspectsForListing(client, input.listingId, input.actor);
  return { archivedCount };
}

export async function unlinkEventFromCatalogListing(
  client: PoolClient,
  eventId: string,
) {
  const updated = await client.query(
    `UPDATE crm.events
     SET catalog_race_listing_id = NULL,
         catalog_match_dismissed_at = NULL,
         updated_at = now()
     WHERE id = $1::uuid
       AND catalog_race_listing_id IS NOT NULL`,
    [eventId],
  );
  if (!updated.rowCount) {
    throw new Error("This event is not linked to Get Run Vibes.");
  }
  await client.query(
    `UPDATE crm.event_occurrences
     SET catalog_race_edition_id = NULL, updated_at = now()
     WHERE event_id = $1::uuid
       AND catalog_race_edition_id IS NOT NULL`,
    [eventId],
  );
}

export async function dismissCatalogMatch(
  client: PoolClient,
  eventId: string,
) {
  const updated = await client.query(
    `UPDATE crm.events
     SET catalog_match_dismissed_at = now(), updated_at = now()
     WHERE id = $1::uuid
       AND catalog_race_listing_id IS NULL`,
    [eventId],
  );
  if (!updated.rowCount) throw new Error("Event not found.");
}

export async function clearCatalogMatchDismissed(
  client: PoolClient,
  eventId: string,
) {
  await client.query(
    `UPDATE crm.events
     SET catalog_match_dismissed_at = NULL, updated_at = now()
     WHERE id = $1::uuid`,
    [eventId],
  );
}

type AutoLinkEvent = EventCandidate & {
  occurrence_id?: string | null;
  catalog_match_dismissed_at?: Date | string | null;
  city?: string | null;
  state?: string | null;
  race_date?: Date | string | null;
};

async function autoLinkEvents(
  client: PoolClient,
  events: AutoLinkEvent[],
  actor?: { id: string; name: string },
  options?: { archiveProspects?: boolean },
) {
  const listings = await loadCatalogListingsForNames(
    client,
    events.map((event) => event.name),
  );
  const listingsByKey = listingsByMatchKey(listings);
  const taken = new Set(
    (
      await client.query<{ id: string }>(liveBookedCatalogListingIdsSql())
    ).rows.map((row) => row.id),
  );
  let linked = 0;
  let archived = 0;
  for (const event of events) {
    if (event.catalog_race_listing_id) continue;
    if (!event.name || isGenericEventName(event.name)) continue;
    const named = listingsByKey.get(eventMatchKey(event.name)) ?? [];
    const match =
      named.length === 1
        ? named[0]
        : uniqueCatalogMatchForEvent(
            {
              name: event.name,
              city: event.city,
              state: event.state,
              raceDate: event.race_date,
            },
            named,
          );
    if (!match || taken.has(match.id)) continue;
    if (actor) {
      const result = await linkEventToCatalogListing(client, {
        eventId: event.id,
        listingId: match.id,
        occurrenceId: event.occurrence_id,
        actor,
        archiveProspects: options?.archiveProspects,
      });
      archived += result.archivedCount;
    } else {
      await client.query(
        `UPDATE crm.events
         SET catalog_race_listing_id = $2, updated_at = now()
         WHERE id = $1::uuid AND catalog_race_listing_id IS NULL`,
        [event.id, match.id],
      );
    }
    taken.add(match.id);
    linked += 1;
  }
  return { linked, archived, considered: events.length };
}

export async function autoLinkEventIfUnique(
  client: PoolClient,
  input: {
    eventId: string;
    occurrenceId?: string | null;
    actor: { id: string; name: string };
    archiveProspects?: boolean;
  },
) {
  const event = await client.query<AutoLinkEvent>(
    `SELECT event.id::text, event.name, event.catalog_race_listing_id,
            event.catalog_match_dismissed_at,
            occurrence.city_override AS city,
            occurrence.state_override AS state,
            occurrence.race_date
     FROM crm.events event
     LEFT JOIN crm.event_occurrences occurrence
       ON occurrence.id = $2::uuid
     WHERE event.id = $1::uuid`,
    [input.eventId, input.occurrenceId ?? null],
  );
  const row = event.rows[0];
  if (!row || row.catalog_race_listing_id || row.catalog_match_dismissed_at) {
    return { linked: 0, archived: 0, considered: event.rows.length };
  }
  return autoLinkEvents(
    client,
    [{ ...row, occurrence_id: input.occurrenceId }],
    input.actor,
    { archiveProspects: input.archiveProspects },
  );
}

export async function autoLinkUniqueCatalogMatches(
  client: PoolClient,
  actor: { id: string; name: string },
) {
  const events = await client.query<AutoLinkEvent>(
    `SELECT DISTINCT ON (event.id)
       event.id::text,
       event.name,
       event.catalog_race_listing_id,
       occurrence.id::text AS occurrence_id,
       occurrence.city_override AS city,
       occurrence.state_override AS state,
       occurrence.race_date
     FROM crm.events event
     JOIN crm.event_occurrences occurrence ON occurrence.event_id = event.id
     JOIN crm.bookings booking ON booking.occurrence_id = occurrence.id
     JOIN crm.pipeline_stages stage ON stage.id = booking.stage_id
     WHERE event.archived_at IS NULL
       AND event.catalog_race_listing_id IS NULL
       AND event.catalog_match_dismissed_at IS NULL
       AND booking.archived_at IS NULL
       AND stage.key <> 'closed_lost'
     ORDER BY event.id, occurrence.race_date DESC NULLS LAST`,
  );
  return autoLinkEvents(client, events.rows, actor);
}

export async function autoLinkUniqueProspectCatalogMatches(
  client: PoolClient,
  actor: { id: string; name: string },
) {
  const events = await client.query<AutoLinkEvent>(
    `SELECT DISTINCT ON (event.id)
       event.id::text,
       event.name,
       event.catalog_race_listing_id,
       occurrence.id::text AS occurrence_id,
       occurrence.city_override AS city,
       occurrence.state_override AS state,
       occurrence.race_date
     FROM crm.prospects prospect
     JOIN crm.events event ON event.id = prospect.event_id
     LEFT JOIN crm.event_occurrences occurrence
       ON occurrence.id = prospect.occurrence_id
     WHERE prospect.archived_at IS NULL
       AND event.archived_at IS NULL
       AND event.catalog_race_listing_id IS NULL
       AND event.catalog_match_dismissed_at IS NULL
     ORDER BY event.id, occurrence.race_date DESC NULLS LAST`,
  );
  return autoLinkEvents(client, events.rows, actor, { archiveProspects: false });
}

export async function reconcileProspectCatalogMatches(
  client: PoolClient,
  actor: { id: string; name: string },
) {
  const linked = await autoLinkUniqueProspectCatalogMatches(client, actor);
  const archivedOwned = await archiveProspectsOwnedByLiveBookings(client, actor);
  const archivedNamed = await archiveUnmatchedProspectsForLiveBookedListings(
    client,
    actor,
  );
  return {
    linked: linked.linked,
    archived: linked.archived + archivedOwned + archivedNamed,
    considered: linked.considered,
  };
}

export async function linkStandingEventsToCatalog(query: QueryFn) {
  const [events, listings] = await Promise.all([
    query<EventCandidate>(
      `SELECT id::text, name, catalog_race_listing_id
       FROM crm.events
       WHERE archived_at IS NULL
         AND catalog_match_dismissed_at IS NULL`,
    ),
    query<CatalogCandidate>(`SELECT id, name FROM catalog.race_listings`),
  ]);

  const listingsByKey = listingsByMatchKey(listings.rows);
  const taken = new Set(
    events.rows
      .map((event) => event.catalog_race_listing_id)
      .filter((id): id is string => Boolean(id)),
  );
  let linked = 0;
  for (const event of events.rows) {
    if (event.catalog_race_listing_id) continue;
    const match = uniqueCatalogMatch(event.name, listingsByKey);
    if (!match || taken.has(match.id)) continue;
    await query(
      `UPDATE crm.events
       SET catalog_race_listing_id = $2, updated_at = now()
       WHERE id = $1::uuid AND catalog_race_listing_id IS NULL`,
      [event.id, match.id],
    );
    taken.add(match.id);
    linked += 1;
  }
  return { linked, considered: events.rows.length };
}
