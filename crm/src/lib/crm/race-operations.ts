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

export function preferredCatalogEditionSql(listingIdExpr: string) {
  return `(
    SELECT re.id
    FROM catalog.race_editions re
    WHERE re.race_listing_id = ${listingIdExpr}
    ORDER BY
      CASE WHEN re.is_future THEN 0 ELSE 1 END,
      abs(extract(epoch from (
        re.starts_at - COALESCE(
          (
            SELECT listing.next_start_at
            FROM catalog.race_listings listing
            WHERE listing.id = ${listingIdExpr}
          ),
          now()
        )
      ))) NULLS LAST,
      re.edition_year DESC NULLS LAST
    LIMIT 1
  )`;
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
  await client.query(
    `DELETE FROM crm.occurrence_races WHERE occurrence_id = $1::uuid`,
    [occurrenceId],
  );

  const occurrence = await client.query<{
    listing_id: string | null;
    race_date: string | null;
  }>(
    `
      SELECT event.catalog_race_listing_id AS listing_id,
             occurrence.race_date::text
      FROM crm.event_occurrences occurrence
      JOIN crm.events event ON event.id = occurrence.event_id
      WHERE occurrence.id = $1::uuid
    `,
    [occurrenceId],
  );
  const listingId = occurrence.rows[0]?.listing_id;
  if (!listingId) {
    await clearOccurrenceScheduleOverrides(client, occurrenceId);
    await recalculateOccurrenceTimes(client, occurrenceId);
    return { inserted: 0 };
  }

  const preferredEdition = await client.query<{ id: string | null }>(
    `SELECT ${preferredCatalogEditionSql("$1")} AS id`,
    [listingId],
  );
  const editionId = preferredEdition.rows[0]?.id ?? null;
  if (editionId) {
    await client.query(
      `
        UPDATE crm.event_occurrences
        SET catalog_race_edition_id = $2, updated_at = now()
        WHERE id = $1::uuid
      `,
      [occurrenceId, editionId],
    );
  }

  const offerings = await loadCatalogOfferingsForListing(client, listingId, {
    editionId,
    raceDate: occurrence.rows[0]?.race_date ?? null,
  });
  const earliestStart = earliestNonVirtualCatalogStart(offerings);
  if (earliestStart) {
    await client.query(
      `
        UPDATE crm.event_occurrences
        SET race_date = $2::timestamp AT TIME ZONE COALESCE(timezone, 'America/New_York'),
            occurrence_year = EXTRACT(YEAR FROM $2::timestamp)::integer,
            updated_at = now()
        WHERE id = $1::uuid
      `,
      [occurrenceId, earliestStart],
    );
  }
  const raceDateForStarts = earliestStart ?? occurrence.rows[0]?.race_date;

  let inserted = 0;
  for (const offering of excludeVirtualCatalogOfferings(offerings)) {
    const meters =
      offering.distance_meters && offering.distance_meters > 0
        ? Math.round(offering.distance_meters)
        : null;
    const miles = meters ? Number((meters / 1609.344).toFixed(3)) : null;
    const startTime = catalogOfferingStartTimestamp({
      raceDate: raceDateForStarts,
      startTimeRaw: offering.start_time_raw,
      startsAt: offering.starts_at,
    });
    const estimatedDuration = estimateRaceDurationMinutes(
      offering.distance_label,
      miles,
      meters,
    );
    await client.query(
      `
        INSERT INTO crm.occurrence_races
          (occurrence_id, catalog_race_offering_id, name, distance_label,
           distance_miles, distance_meters, start_time,
           estimated_duration_minutes, sort_order)
        VALUES (
          $1::uuid, $2, $3, $4, $5, $6, $7::timestamp, $8, $9
        )
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
        inserted,
      ],
    );
    inserted += 1;
  }

  await clearOccurrenceScheduleOverrides(client, occurrenceId);
  await recalculateOccurrenceTimes(client, occurrenceId);
  return { inserted };
}

export async function resetOperationsAndSyncCatalogRaces(client: PoolClient) {
  await client.query(
    `
      UPDATE crm.event_occurrences
      SET notes = NULL,
          arrival_override_at = NULL,
          departure_override_at = NULL,
          updated_at = now()
      WHERE notes IS NOT NULL
         OR arrival_override_at IS NOT NULL
         OR departure_override_at IS NOT NULL
    `,
  );
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
