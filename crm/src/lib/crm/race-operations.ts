import type { PoolClient } from "pg";

const knownDurations: Array<[RegExp, number]> = [
  [/^(1\s*(mile|mi)|one\s*mile)$/i, 60],
  [/^5\s*k$/i, 120],
  [/^10\s*k$/i, 180],
  [/^15\s*k$/i, 240],
  [/^(half\s*marathon|13\.1(\s*(mile|mi))?)$/i, 300],
  [/^(marathon|26\.2(\s*(mile|mi))?)$/i, 480],
];

export function estimateRaceDurationMinutes(
  distanceLabel?: string | null,
  distanceMiles?: number | null,
  distanceMeters?: number | null,
) {
  const normalized = distanceLabel?.trim().replaceAll("-", " ") ?? "";
  for (const [pattern, minutes] of knownDurations) {
    if (pattern.test(normalized)) return minutes;
  }

  const labelKilometers = normalized.match(
    /(\d+(?:\.\d+)?)\s*(?:k|km|kilometer)/i,
  );
  const labelMiles = normalized.match(
    /(\d+(?:\.\d+)?)\s*(?:mile|miles|mi)\b/i,
  );
  const miles =
    distanceMiles && distanceMiles > 0
      ? distanceMiles
      : distanceMeters && distanceMeters > 0
        ? distanceMeters / 1609.344
        : labelKilometers
          ? Number(labelKilometers[1]) * 0.621371
          : labelMiles
            ? Number(labelMiles[1])
            : null;
  if (!miles) return null;
  return Math.ceil((miles * 18 + 45) / 15) * 15;
}

export async function shiftOccurrenceRaceTimes(
  client: PoolClient,
  occurrenceId: string,
  previousRaceDate: string | null,
  nextRaceDate: string | null,
  timezone: string,
) {
  if (!previousRaceDate || !nextRaceDate) return;
  await client.query(
    `
      UPDATE crm.occurrence_races
      SET start_time = start_time + (
            ($2::timestamp AT TIME ZONE $4) - $3::timestamptz
          ),
          updated_at = now()
      WHERE occurrence_id = $1::uuid
        AND start_time IS NOT NULL
    `,
    [occurrenceId, nextRaceDate, previousRaceDate, timezone],
  );
}

export async function recalculateOccurrenceTimes(
  client: PoolClient,
  occurrenceId: string,
) {
  await client.query(
    `
      WITH calculated AS (
        SELECT
          occurrence.id,
          (
            MIN(race.start_time)
              AT TIME ZONE COALESCE(occurrence.timezone, 'America/New_York')
          ) - interval '2 hours' AS arrival_at,
          MAX(
            (
              race.start_time + make_interval(
                mins => COALESCE(
                  race.duration_override_minutes,
                  race.estimated_duration_minutes
                )
              )
            ) AT TIME ZONE COALESCE(occurrence.timezone, 'America/New_York')
          ) FILTER (
            WHERE COALESCE(
              race.duration_override_minutes,
              race.estimated_duration_minutes
            ) IS NOT NULL
          ) AS departure_at
        FROM crm.event_occurrences occurrence
        LEFT JOIN crm.occurrence_races race
          ON race.occurrence_id = occurrence.id
        WHERE occurrence.id = $1::uuid
        GROUP BY occurrence.id
      )
      UPDATE crm.event_occurrences
      SET calculated_arrival_at = calculated.arrival_at,
          calculated_departure_at = calculated.departure_at,
          updated_at = now()
      FROM calculated
      WHERE event_occurrences.id = calculated.id
    `,
    [occurrenceId],
  );
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function parseCatalogClock(startTimeRaw?: string | null) {
  const match = startTimeRaw?.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (match[3]) {
    const period = match[3].toUpperCase();
    hours = period === "PM" ? (hours % 12) + 12 : hours % 12;
  }
  if (hours === 0 && minutes === 0) return null;
  return { hours, minutes };
}

export function catalogDatePart(value?: string | Date | null) {
  if (!value) return null;
  const text = value instanceof Date ? value.toISOString() : String(value);
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (us) return `${us[3]}-${pad(Number(us[1]))}-${pad(Number(us[2]))}`;
  return null;
}

export function catalogOfferingStartTimestamp(input: {
  raceDate?: string | Date | null;
  startTimeRaw?: string | null;
  startsAt?: string | null;
}) {
  const clock = parseCatalogClock(input.startTimeRaw);
  const datePart =
    catalogDatePart(input.raceDate) ??
    catalogDatePart(input.startTimeRaw) ??
    catalogDatePart(input.startsAt);
  if (!datePart || !clock) return null;
  return `${datePart} ${pad(clock.hours)}:${pad(clock.minutes)}:00`;
}

const VIRTUAL_TOKEN = /virtual/i;

function flagIsTrue(value: unknown) {
  if (value === true || value === 1) return true;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function textHasVirtual(value: unknown): boolean {
  if (typeof value === "string") return VIRTUAL_TOKEN.test(value);
  if (Array.isArray(value)) return value.some(textHasVirtual);
  return false;
}

export type CatalogOfferingLike = {
  name?: string | null;
  distance_label?: string | null;
  distanceLabel?: string | null;
  event_type?: string | null;
  eventType?: string | null;
  type?: string | null;
  tag?: string | null;
  tags?: unknown;
  normalized_event_family?: string | null;
  normalizedEventFamily?: string | null;
  is_virtual?: unknown;
  isVirtual?: unknown;
  virtual?: unknown;
};

export function isVirtualCatalogOffering(offering: CatalogOfferingLike) {
  if (
    flagIsTrue(offering.is_virtual) ||
    flagIsTrue(offering.isVirtual) ||
    flagIsTrue(offering.virtual)
  ) {
    return true;
  }
  return [
    offering.name,
    offering.distance_label ?? offering.distanceLabel,
    offering.event_type ?? offering.eventType,
    offering.type,
    offering.tag,
    offering.tags,
    offering.normalized_event_family ?? offering.normalizedEventFamily,
  ].some(textHasVirtual);
}

export function excludeVirtualCatalogOfferings<T extends CatalogOfferingLike>(
  offerings: readonly T[],
) {
  return offerings.filter((offering) => !isVirtualCatalogOffering(offering));
}

export type CatalogOfferingStartLike = CatalogOfferingLike & {
  start_time_raw?: string | null;
  startTimeRaw?: string | null;
  starts_at?: string | Date | null;
  startsAt?: string | Date | null;
};

export function catalogOfferingOwnStartTimestamp(
  offering: CatalogOfferingStartLike,
) {
  const startTimeRaw = offering.start_time_raw ?? offering.startTimeRaw ?? null;
  const startsAt = offering.starts_at ?? offering.startsAt ?? null;
  const startsAtText = startsAt == null ? null : String(startsAt);
  return catalogOfferingStartTimestamp({
    raceDate: startsAtText ?? startTimeRaw,
    startTimeRaw: startTimeRaw ?? startsAtText,
    startsAt: startsAtText,
  });
}

export function earliestNonVirtualCatalogStart(
  offerings: readonly CatalogOfferingStartLike[],
) {
  const starts = excludeVirtualCatalogOfferings(offerings)
    .map((offering) => catalogOfferingOwnStartTimestamp(offering))
    .filter((value): value is string => Boolean(value))
    .sort();
  return starts[0] ?? null;
}

export type CatalogOfferingRow = CatalogOfferingStartLike & {
  id: string;
  name: string;
  distance_label: string | null;
  distance_meters: number | null;
  start_time_raw: string | null;
  starts_at: string | null;
  event_type: string | null;
  normalized_event_family: string | null;
  is_virtual: boolean | null;
};

export function preferredCatalogEditionId<
  T extends {
    id: string;
    is_future?: boolean | null;
    starts_at?: string | Date | null;
    edition_year?: number | null;
  },
>(editions: T[], nextStartAt?: string | Date | null) {
  if (!editions.length) return null;
  const nextMs = nextStartAt ? new Date(nextStartAt).valueOf() : Number.NaN;
  const distance = (startsAt: string | Date | null | undefined) => {
    if (!startsAt || Number.isNaN(nextMs)) return Number.POSITIVE_INFINITY;
    const ms = new Date(startsAt).valueOf();
    return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : Math.abs(ms - nextMs);
  };
  const ranked = [...editions].sort((left, right) => {
    const futureDiff = Number(!left.is_future) - Number(!right.is_future);
    if (futureDiff !== 0) return futureDiff;
    const startDiff = distance(left.starts_at) - distance(right.starts_at);
    if (startDiff !== 0) return startDiff;
    return (right.edition_year ?? 0) - (left.edition_year ?? 0);
  });
  return ranked[0]?.id ?? null;
}

export function preferredCatalogEditionSql(
  listingIdExpr: string,
  yearExpr: string | null = null,
) {
  const yearRank = yearExpr
    ? `CASE WHEN re.edition_year = ${yearExpr} THEN 0 ELSE 1 END,`
    : "";
  return `(
    SELECT re.id
    FROM catalog.race_editions re
    WHERE re.race_listing_id = ${listingIdExpr}
    ORDER BY
      ${yearRank}
      CASE WHEN re.is_future THEN 0 ELSE 1 END,
      abs(extract(epoch from (
        re.starts_at - COALESCE(
          (
            SELECT next_start_at
            FROM catalog.race_listings
            WHERE id = ${listingIdExpr}
            LIMIT 1
          ),
          now()
        )
      ))) NULLS LAST,
      re.edition_year DESC NULLS LAST
    LIMIT 1
  )`;
}

export function offeringsMatchingOccurrenceDate<T extends CatalogOfferingStartLike>(
  offerings: readonly T[],
  raceDate?: string | Date | null,
) {
  const visible = excludeVirtualCatalogOfferings(offerings);
  const day = catalogDatePart(raceDate);
  if (!day) return visible;
  const exact = visible.filter((offering) => {
    const offeringDay =
      catalogDatePart(offering.starts_at ?? offering.startsAt) ??
      catalogDatePart(offering.start_time_raw ?? offering.startTimeRaw);
    return offeringDay === day;
  });
  if (exact.length) return exact;
  const dated = visible.filter((offering) =>
    Boolean(
      catalogDatePart(offering.starts_at ?? offering.startsAt) ??
        catalogDatePart(offering.start_time_raw ?? offering.startTimeRaw),
    ),
  );
  return dated.length ? [] : visible;
}

export type CatalogRaceDateMismatch = {
  bookingDate: string;
  listingDates: string[];
};

export function formatCatalogDayLabel(isoDay: string) {
  const match = isoDay.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return isoDay;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

export function joinCatalogDayLabels(dates: string[]) {
  if (dates.length <= 1) return dates[0] ?? "";
  if (dates.length === 2) return `${dates[0]} and ${dates[1]}`;
  return `${dates.slice(0, -1).join(", ")}, and ${dates[dates.length - 1]}`;
}

export function catalogOfferingDay(offering: CatalogOfferingStartLike) {
  return (
    catalogDatePart(offering.start_time_raw ?? offering.startTimeRaw) ??
    catalogDatePart(offering.starts_at ?? offering.startsAt)
  );
}

export function catalogRaceDateMismatch(
  offerings: readonly CatalogOfferingStartLike[],
  raceDate?: string | Date | null,
): CatalogRaceDateMismatch | null {
  if (offeringsMatchingOccurrenceDate(offerings, raceDate).length) return null;
  const bookingDay = catalogDatePart(raceDate);
  if (!bookingDay) return null;
  const listingDays = [
    ...new Set(
      excludeVirtualCatalogOfferings(offerings)
        .map(catalogOfferingDay)
        .filter((day): day is string => Boolean(day)),
    ),
  ];
  if (!listingDays.length) return null;
  return {
    bookingDate: formatCatalogDayLabel(bookingDay),
    listingDates: listingDays.map(formatCatalogDayLabel),
  };
}

export function catalogRaceDateMismatchMessage(mismatch: CatalogRaceDateMismatch) {
  return `The online listing’s races are on ${joinCatalogDayLabels(mismatch.listingDates)}, but this booking is dated ${mismatch.bookingDate}. Refresh will not copy those races, and Google Calendar stays unavailable, until the dates match. Change Event details, then Refresh from online listing, or add race start times manually.`;
}

export async function loadCatalogOfferingsForListing(
  client: PoolClient,
  listingId: string,
  options: { raceDate?: string | null; editionId?: string | null } = {},
) {
  const offerings = await client.query<CatalogOfferingRow>(
    `
      SELECT
        offering.id,
        offering.name,
        offering.distance_label,
        offering.distance_meters,
        offering.start_time_raw,
        offering.starts_at::text,
        offering.event_type,
        offering.normalized_event_family,
        offering.is_virtual
      FROM catalog.race_offerings offering
      WHERE offering.race_listing_id = $1
        AND COALESCE(offering.is_merch_only, false) = false
        AND COALESCE(offering.is_volunteer, false) = false
        AND offering.race_edition_id = COALESCE(
          $2,
          ${preferredCatalogEditionSql("$1")}
        )
      ORDER BY offering.starts_at NULLS LAST, offering.name
    `,
    [listingId, options.editionId ?? null],
  );
  return offerings.rows;
}

export async function clearOccurrenceScheduleOverrides(
  client: PoolClient,
  occurrenceId: string,
) {
  await client.query(
    `
      UPDATE crm.event_occurrences
      SET arrival_override_at = NULL,
          departure_override_at = NULL,
          updated_at = now()
      WHERE id = $1::uuid
    `,
    [occurrenceId],
  );
}

export async function syncOccurrenceRacesFromCatalog(
  client: PoolClient,
  occurrenceId: string,
) {
  const occurrence = await client.query<{
    listing_id: string | null;
    race_date: string | null;
    occurrence_year: number | null;
    catalog_race_edition_id: string | null;
  }>(
    `
      SELECT event.catalog_race_listing_id AS listing_id,
             occurrence.race_date::text,
             occurrence.occurrence_year,
             occurrence.catalog_race_edition_id
      FROM crm.event_occurrences occurrence
      JOIN crm.events event ON event.id = occurrence.event_id
      WHERE occurrence.id = $1::uuid
    `,
    [occurrenceId],
  );
  const listingId = occurrence.rows[0]?.listing_id;
  if (!listingId) {
    await recalculateOccurrenceTimes(client, occurrenceId);
    return { inserted: 0, updated: 0, removed: 0 };
  }

  const occurrenceYear = occurrence.rows[0]?.occurrence_year ?? null;
  const existingEdition = occurrence.rows[0]?.catalog_race_edition_id ?? null;
  let editionId = existingEdition;
  if (!editionId) {
    const preferredEdition = await client.query<{ id: string | null }>(
      `SELECT ${preferredCatalogEditionSql("$1", occurrenceYear ? "$2" : null)} AS id`,
      occurrenceYear ? [listingId, occurrenceYear] : [listingId],
    );
    editionId = preferredEdition.rows[0]?.id ?? null;
    if (editionId) {
      await client.query(
        `
          UPDATE crm.event_occurrences
          SET catalog_race_edition_id = $2, updated_at = now()
          WHERE id = $1::uuid AND catalog_race_edition_id IS NULL
        `,
        [occurrenceId, editionId],
      );
    }
  }

  const offerings = await loadCatalogOfferingsForListing(client, listingId, {
    editionId,
    raceDate: occurrence.rows[0]?.race_date ?? null,
  });
  const matching = offeringsMatchingOccurrenceDate(
    offerings,
    occurrence.rows[0]?.race_date,
  );

  const existing = await client.query<{
    id: string;
    catalog_race_offering_id: string | null;
  }>(
    `
      SELECT id::text, catalog_race_offering_id
      FROM crm.occurrence_races
      WHERE occurrence_id = $1::uuid
    `,
    [occurrenceId],
  );
  const byOffering = new Map<string, string[]>();
  for (const row of existing.rows) {
    if (!row.catalog_race_offering_id) continue;
    const current = byOffering.get(row.catalog_race_offering_id) ?? [];
    current.push(row.id);
    byOffering.set(row.catalog_race_offering_id, current);
  }

  const keepIds = new Set<string>();
  let inserted = 0;
  let updated = 0;
  let sortOrder = 0;
  for (const offering of matching) {
    const meters =
      offering.distance_meters && offering.distance_meters > 0
        ? Math.round(offering.distance_meters)
        : null;
    const miles = meters ? Number((meters / 1609.344).toFixed(3)) : null;
    const startTime =
      catalogOfferingOwnStartTimestamp(offering) ??
      catalogOfferingStartTimestamp({
        raceDate: occurrence.rows[0]?.race_date,
        startTimeRaw: offering.start_time_raw,
        startsAt: offering.starts_at,
      });
    const estimatedDuration = estimateRaceDurationMinutes(
      offering.distance_label,
      miles,
      meters,
    );
    const matches = byOffering.get(offering.id) ?? [];
    const primaryId = matches[0];
    if (primaryId) {
      await client.query(
        `
          UPDATE crm.occurrence_races
          SET name = $2,
              distance_label = $3,
              distance_miles = $4,
              distance_meters = $5,
              start_time = $6::timestamp,
              estimated_duration_minutes = $7,
              sort_order = $8,
              updated_at = now()
          WHERE id = $1::uuid
        `,
        [
          primaryId,
          offering.name,
          offering.distance_label,
          miles,
          meters,
          startTime,
          estimatedDuration,
          sortOrder,
        ],
      );
      keepIds.add(primaryId);
      updated += 1;
    } else {
      const created = await client.query<{ id: string }>(
        `
          INSERT INTO crm.occurrence_races
            (occurrence_id, catalog_race_offering_id, name, distance_label,
             distance_miles, distance_meters, start_time,
             estimated_duration_minutes, sort_order)
          VALUES (
            $1::uuid, $2, $3, $4, $5, $6, $7::timestamp, $8, $9
          )
          RETURNING id::text
        `,
        [
          occurrenceId,
          offering.id,
          offering.name,
          offering.distance_label,
          miles,
          meters,
          startTime,
          estimatedDuration,
          sortOrder,
        ],
      );
      if (created.rows[0]?.id) keepIds.add(created.rows[0].id);
      inserted += 1;
    }
    sortOrder += 1;
  }

  const staleIds = existing.rows
    .filter(
      (row) =>
        row.catalog_race_offering_id &&
        !keepIds.has(row.id),
    )
    .map((row) => row.id);
  if (staleIds.length) {
    await client.query(
      `DELETE FROM crm.occurrence_races
       WHERE occurrence_id = $1::uuid
         AND catalog_race_offering_id IS NOT NULL
         AND id = ANY($2::uuid[])`,
      [occurrenceId, staleIds],
    );
  }

  await recalculateOccurrenceTimes(client, occurrenceId);
  return { inserted, updated, removed: staleIds.length };
}

export async function resetOperationsAndSyncCatalogRaces(client: PoolClient) {
  const occurrences = await client.query<{ id: string }>(
    `
      SELECT occurrence.id::text
      FROM crm.event_occurrences occurrence
      JOIN crm.events event ON event.id = occurrence.event_id
      JOIN crm.bookings booking ON booking.occurrence_id = occurrence.id
      WHERE event.catalog_race_listing_id IS NOT NULL
        AND booking.archived_at IS NULL
    `,
  );
  let inserted = 0;
  let synced = 0;
  for (const row of occurrences.rows) {
    const result = await syncOccurrenceRacesFromCatalog(client, row.id);
    inserted += result.inserted;
    synced += 1;
  }
  return { occurrences: synced, inserted };
}
