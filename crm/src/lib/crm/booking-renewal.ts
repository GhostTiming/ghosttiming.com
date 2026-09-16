import type { PoolClient } from "pg";
import { appendAuditActivity } from "./audit";
import { linkEventToCatalogListing } from "./catalog-link";
import { eventMatchKey } from "./event-matching";
import {
  earliestNonVirtualCatalogStart,
  loadCatalogOfferingsForListing,
  recalculateOccurrenceTimes,
  syncOccurrenceRacesFromCatalog,
} from "./race-operations";

export const RENEWAL_BOOKING_STAGE_KEY = "confirmed";

export type RenewalFieldPolicy = {
  copyBooking: string[];
  resetBooking: string[];
  copyOccurrenceAlways: string[];
  copyOccurrenceUnlessCatalogRefresh: string[];
  neverCopyOccurrence: string[];
};

export function renewalFieldPolicy(): RenewalFieldPolicy {
  return {
    copyBooking: [
      "direct_client_organization_id",
      "primary_contact_person_id",
      "assigned_user_id",
      "expected_revenue",
      "notes",
    ],
    resetBooking: [
      "stage:confirmed",
      "actual_revenue",
      "amount_paid",
      "completed_at",
      "payment_due_at",
      "payment_at",
      "prep_items:fresh",
    ],
    copyOccurrenceAlways: [
      "event_owner_organization_id",
      "timer_location",
      "hardware_event_name",
      "scoring_expectations",
      "post_event_expectations",
      "notes",
      "crew_assignments",
      "course_points",
    ],
    copyOccurrenceUnlessCatalogRefresh: [
      "timezone",
      "registration_url_override",
      "street_override",
      "street2_override",
      "city_override",
      "state_override",
      "zipcode_override",
      "occurrence_races:shifted",
    ],
    neverCopyOccurrence: [
      "calculated_arrival_at",
      "arrival_override_at",
      "calculated_departure_at",
      "departure_override_at",
      "catalog_race_edition_id",
    ],
  };
}

export function calendarYearFromValue(
  value: Date | string | number | null | undefined,
) {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value.getUTCFullYear();
  }
  if (typeof value === "string") {
    const match = value.trim().match(/^(\d{4})/);
    if (match) return Number(match[1]);
  }
  return null;
}

export function defaultRenewalYear(input: {
  raceDate?: Date | string | null;
  occurrenceYear?: number | null;
  now?: Date;
}) {
  return (
    calendarYearFromValue(input.occurrenceYear) ??
    calendarYearFromValue(input.raceDate) ??
    (input.now ?? new Date()).getFullYear()
  ) + 1;
}

export function renewalYearDelta(sourceYear: number, targetYear: number) {
  return targetYear - sourceYear;
}

export function shiftLocalDateTimeByYears(
  value: string | null | undefined,
  years: number,
) {
  if (!value?.trim()) return null;
  const match = value.trim().match(/^(\d{4})([-T].*)$/);
  if (!match) return value.trim();
  return `${Number(match[1]) + years}${match[2]}`;
}

export type CatalogEditionLike = {
  id: string;
  editionYear: number | null;
  startsAt: Date | string | null;
  timezone?: string | null;
  isFuture?: boolean | null;
};

export function pickCatalogEditionForYear(
  editions: CatalogEditionLike[],
  year: number,
) {
  const matching = editions.filter((edition) => {
    if (edition.editionYear === year) return true;
    return calendarYearFromValue(edition.startsAt) === year;
  });
  if (!matching.length) return null;
  return [...matching].sort((left, right) => {
    const future = Number(Boolean(right.isFuture)) - Number(Boolean(left.isFuture));
    if (future) return future;
    const yearScore =
      Number(right.editionYear === year) - Number(left.editionYear === year);
    if (yearScore) return yearScore;
    return String(left.startsAt ?? "").localeCompare(String(right.startsAt ?? ""));
  })[0];
}

export function shouldOpenNewStandingEvent(input: {
  refreshFromCatalog: boolean;
  currentListingId?: string | null;
  nextListingId?: string | null;
  currentEventName: string;
  nextEventName?: string | null;
}) {
  if (
    input.refreshFromCatalog &&
    input.nextListingId &&
    input.currentListingId &&
    input.nextListingId !== input.currentListingId
  ) {
    return true;
  }
  const nextName = input.nextEventName?.trim();
  if (!input.refreshFromCatalog && nextName) {
    return eventMatchKey(nextName) !== eventMatchKey(input.currentEventName);
  }
  return false;
}

export type RenewBookingInput = {
  bookingId: string;
  actor: { id: string; name: string };
  targetYear: number;
  refreshFromCatalog: boolean;
  eventName?: string;
  raceDateLocal?: string | null;
  timezone?: string;
  registrationUrl?: string | null;
  street?: string | null;
  street2?: string | null;
  city?: string | null;
  state?: string | null;
  zipcode?: string | null;
};

type SourceBooking = {
  booking_id: string;
  occurrence_id: string;
  event_id: string;
  event_name: string;
  event_notes: string | null;
  event_website: string | null;
  event_source_type: string;
  default_owner_organization_id: string | null;
  catalog_race_listing_id: string | null;
  occurrence_year: number | null;
  race_date: string | null;
  timezone: string | null;
  event_owner_organization_id: string | null;
  registration_url_override: string | null;
  street_override: string | null;
  street2_override: string | null;
  city_override: string | null;
  state_override: string | null;
  zipcode_override: string | null;
  timer_location: string | null;
  hardware_event_name: string | null;
  scoring_expectations: string | null;
  post_event_expectations: string | null;
  operations_notes: string | null;
  direct_client_organization_id: string;
  primary_contact_person_id: string | null;
  assigned_user_id: string | null;
  expected_revenue: string | null;
  booking_notes: string | null;
};

type CatalogListingRow = {
  id: string;
  name: string;
  registration_url: string | null;
  external_race_url: string | null;
  street: string | null;
  street2: string | null;
  city: string | null;
  state: string | null;
  zipcode: string | null;
  timezone: string | null;
  next_start_at: string | null;
};

async function loadSourceBooking(client: PoolClient, bookingId: string) {
  const result = await client.query<SourceBooking>(
    `
      SELECT
        booking.id::text AS booking_id,
        occurrence.id::text AS occurrence_id,
        event.id::text AS event_id,
        event.name AS event_name,
        event.notes AS event_notes,
        event.website AS event_website,
        event.source_type::text AS event_source_type,
        event.default_owner_organization_id::text,
        event.catalog_race_listing_id,
        occurrence.occurrence_year,
        occurrence.race_date::text,
        occurrence.timezone,
        occurrence.event_owner_organization_id::text,
        occurrence.registration_url_override,
        occurrence.street_override,
        occurrence.street2_override,
        occurrence.city_override,
        occurrence.state_override,
        occurrence.zipcode_override,
        occurrence.timer_location::text,
        occurrence.hardware_event_name,
        occurrence.scoring_expectations,
        occurrence.post_event_expectations,
        occurrence.notes AS operations_notes,
        booking.direct_client_organization_id::text,
        booking.primary_contact_person_id::text,
        booking.assigned_user_id::text,
        booking.expected_revenue::text,
        booking.notes AS booking_notes
      FROM crm.bookings booking
      JOIN crm.event_occurrences occurrence ON occurrence.id = booking.occurrence_id
      JOIN crm.events event ON event.id = occurrence.event_id
      WHERE booking.id = $1::uuid
      FOR UPDATE OF booking
    `,
    [bookingId],
  );
  return result.rows[0] ?? null;
}

async function loadCatalogListing(client: PoolClient, listingId: string) {
  const result = await client.query<CatalogListingRow>(
    `
      SELECT
        id, name, registration_url, external_race_url,
        street, street2, city, state, zipcode, timezone,
        next_start_at::text
      FROM catalog.race_listings
      WHERE id = $1
    `,
    [listingId],
  );
  return result.rows[0] ?? null;
}

async function loadCatalogEditionForYear(
  client: PoolClient,
  listingId: string,
  year: number,
) {
  const result = await client.query<{
    id: string;
    edition_year: number | null;
    starts_at: string | null;
    timezone: string | null;
    is_future: boolean;
  }>(
    `
      SELECT id, edition_year, starts_at::text, timezone, is_future
      FROM catalog.race_editions
      WHERE race_listing_id = $1
        AND (
          edition_year = $2
          OR EXTRACT(YEAR FROM starts_at) = $2
        )
      ORDER BY
        CASE WHEN is_future THEN 0 ELSE 1 END,
        CASE WHEN edition_year = $2 THEN 0 ELSE 1 END,
        starts_at NULLS LAST
      LIMIT 1
    `,
    [listingId, year],
  );
  return result.rows[0] ?? null;
}

async function findYearSpecificListing(
  client: PoolClient,
  current: CatalogListingRow,
  year: number,
) {
  const tokens = eventMatchKey(current.name)
    .split(" ")
    .filter((token) => token.length >= 3)
    .slice(0, 3);
  if (!tokens.length) return null;
  const listings = await client.query<CatalogListingRow>(
    `
      SELECT
        listing.id, listing.name, listing.registration_url, listing.external_race_url,
        listing.street, listing.street2, listing.city, listing.state, listing.zipcode,
        listing.timezone, listing.next_start_at::text
      FROM catalog.race_listings listing
      WHERE listing.id <> $1
        AND ${tokens
          .map((_, index) => `lower(listing.name) LIKE '%' || $${index + 2} || '%'`)
          .join(" AND ")}
        AND NOT EXISTS (
          SELECT 1 FROM crm.events event
          WHERE event.catalog_race_listing_id = listing.id
        )
      LIMIT 25
    `,
    [current.id, ...tokens],
  );
  const matches = listings.rows.filter((listing) => {
    if (eventMatchKey(listing.name) !== eventMatchKey(current.name)) return false;
    return calendarYearFromValue(listing.next_start_at) === year;
  });
  return matches.length === 1 ? matches[0] : null;
}

async function editionIsAvailable(
  client: PoolClient,
  editionId: string | null,
) {
  if (!editionId) return false;
  const taken = await client.query<{ id: string }>(
    `SELECT id::text FROM crm.event_occurrences
     WHERE catalog_race_edition_id = $1`,
    [editionId],
  );
  return !taken.rows[0];
}

async function existingBookingForYear(
  client: PoolClient,
  eventId: string,
  year: number,
) {
  const result = await client.query<{
    booking_id: string | null;
    occurrence_id: string;
  }>(
    `
      SELECT booking.id::text AS booking_id, occurrence.id::text AS occurrence_id
      FROM crm.event_occurrences occurrence
      LEFT JOIN crm.bookings booking ON booking.occurrence_id = occurrence.id
      WHERE occurrence.event_id = $1::uuid
        AND occurrence.occurrence_year = $2
      ORDER BY booking.id NULLS FIRST
      LIMIT 1
    `,
    [eventId, year],
  );
  return result.rows[0] ?? null;
}

async function copyCrewAndCourse(
  client: PoolClient,
  sourceOccurrenceId: string,
  targetOccurrenceId: string,
) {
  await client.query(
    `
      INSERT INTO crm.crew_assignments
        (occurrence_id, person_id, freeform_name, role, notes)
      SELECT $2::uuid, person_id, freeform_name, role, notes
      FROM crm.crew_assignments
      WHERE occurrence_id = $1::uuid
    `,
    [sourceOccurrenceId, targetOccurrenceId],
  );
  await client.query(
    `
      INSERT INTO crm.course_points
        (occurrence_id, name, hardware_point_name, notes, sort_order)
      SELECT $2::uuid, name, hardware_point_name, notes, sort_order
      FROM crm.course_points
      WHERE occurrence_id = $1::uuid
    `,
    [sourceOccurrenceId, targetOccurrenceId],
  );
}

async function copyOccurrenceRacesShifted(
  client: PoolClient,
  sourceOccurrenceId: string,
  targetOccurrenceId: string,
  years: number,
) {
  await client.query(
    `
      INSERT INTO crm.occurrence_races
        (occurrence_id, catalog_race_offering_id, name, distance_label,
         distance_miles, distance_meters, start_time, age_groups, awards,
         estimated_duration_minutes, duration_override_minutes, sort_order)
      SELECT
        $2::uuid, catalog_race_offering_id, name, distance_label,
        distance_miles, distance_meters,
        CASE WHEN start_time IS NULL THEN NULL
             ELSE start_time + ($3::integer * interval '1 year') END,
        age_groups, awards, estimated_duration_minutes,
        duration_override_minutes, sort_order
      FROM crm.occurrence_races
      WHERE occurrence_id = $1::uuid
    `,
    [sourceOccurrenceId, targetOccurrenceId, years],
  );
}

export async function renewBooking(client: PoolClient, input: RenewBookingInput) {
  const source = await loadSourceBooking(client, input.bookingId);
  if (!source) throw new Error("Booking not found.");

  const sourceYear =
    calendarYearFromValue(source.occurrence_year) ??
    calendarYearFromValue(source.race_date) ??
    input.targetYear - 1;
  const yearDelta = renewalYearDelta(sourceYear, input.targetYear);
  if (yearDelta === 0) {
    throw new Error("Pick a different year than this booking already uses.");
  }

  const refreshFromCatalog =
    input.refreshFromCatalog && Boolean(source.catalog_race_listing_id);
  if (input.refreshFromCatalog && !source.catalog_race_listing_id) {
    throw new Error("This booking is not linked to Get Run Vibes.");
  }

  let listing: CatalogListingRow | null = null;
  let edition: {
    id: string;
    edition_year: number | null;
    starts_at: string | null;
    timezone: string | null;
    is_future: boolean;
  } | null = null;
  if (refreshFromCatalog && source.catalog_race_listing_id) {
    listing = await loadCatalogListing(client, source.catalog_race_listing_id);
    if (!listing) throw new Error("Get Run Vibes listing was not found.");
    const yearListing = await findYearSpecificListing(
      client,
      listing,
      input.targetYear,
    );
    if (yearListing) listing = yearListing;
    edition = await loadCatalogEditionForYear(client, listing.id, input.targetYear);
  }

  const nextEventName = refreshFromCatalog
    ? (listing?.name ?? source.event_name)
    : (input.eventName?.trim() || source.event_name);
  const openNewEvent = shouldOpenNewStandingEvent({
    refreshFromCatalog,
    currentListingId: source.catalog_race_listing_id,
    nextListingId: listing?.id ?? null,
    currentEventName: source.event_name,
    nextEventName,
  });

  let eventId = source.event_id;
  if (openNewEvent) {
    const created = await client.query<{ id: string }>(
      `
        INSERT INTO crm.events
          (name, catalog_race_listing_id, source_type,
           default_owner_organization_id, website, notes)
        VALUES ($1, $2, $3, $4::uuid, $5, $6)
        RETURNING id::text
      `,
      [
        nextEventName,
        refreshFromCatalog ? (listing?.id ?? null) : null,
        source.event_source_type || "manual",
        source.default_owner_organization_id,
        refreshFromCatalog
          ? (listing?.registration_url ?? listing?.external_race_url ?? source.event_website)
          : (input.registrationUrl ?? source.event_website),
        source.event_notes,
      ],
    );
    eventId = created.rows[0].id;
  } else if (refreshFromCatalog && listing) {
    await client.query(
      `
        UPDATE crm.events
        SET name = $2,
            website = COALESCE($3, website),
            updated_at = now()
        WHERE id = $1::uuid
      `,
      [
        eventId,
        listing.name,
        listing.registration_url ?? listing.external_race_url,
      ],
    );
  }

  const existing = await existingBookingForYear(client, eventId, input.targetYear);
  if (existing?.booking_id) {
    throw new Error(
      `A ${input.targetYear} booking already exists for this event.`,
    );
  }

  const timezone =
    (refreshFromCatalog
      ? edition?.timezone || listing?.timezone || source.timezone
      : input.timezone?.trim() || source.timezone) || "America/New_York";
  const catalogOfferings =
    refreshFromCatalog && listing
      ? await loadCatalogOfferingsForListing(client, listing.id, {
          editionId: edition?.id ?? null,
          raceDate: edition?.starts_at ?? listing.next_start_at,
        })
      : [];
  const earliestNonVirtualStart = earliestNonVirtualCatalogStart(catalogOfferings);
  const catalogStart = earliestNonVirtualStart
    ? null
    : edition?.starts_at ||
      (calendarYearFromValue(listing?.next_start_at) === input.targetYear
        ? listing?.next_start_at
        : null);
  const raceDateLocal = refreshFromCatalog
    ? earliestNonVirtualStart
    : (input.raceDateLocal?.trim() ||
        shiftLocalDateTimeByYears(source.race_date, yearDelta));
  const editionAvailable = await editionIsAvailable(client, edition?.id ?? null);

  const occurrence = existing
    ? { id: existing.occurrence_id }
    : (
        await client.query<{ id: string }>(
          `
            INSERT INTO crm.event_occurrences
              (event_id, catalog_race_edition_id, occurrence_year, race_date,
               timezone, event_owner_organization_id, registration_url_override,
               street_override, street2_override, city_override, state_override,
               zipcode_override, timer_location, hardware_event_name,
               scoring_expectations, post_event_expectations, notes)
            VALUES (
              $1::uuid, $2, $3,
              CASE
                WHEN $4::timestamptz IS NOT NULL THEN $4::timestamptz
                WHEN $5::text IS NOT NULL THEN $5::timestamp AT TIME ZONE $6
                WHEN $7::timestamptz IS NOT NULL
                  THEN $7::timestamptz + ($8::integer * interval '1 year')
                ELSE NULL
              END,
              $6, $9::uuid, $10, $11, $12, $13, $14, $15,
              $16::crm.timer_location, $17, $18, $19, $20
            )
            RETURNING id::text
          `,
          [
            eventId,
            editionAvailable ? edition?.id ?? null : null,
            input.targetYear,
            catalogStart,
            raceDateLocal,
            timezone,
            source.race_date,
            yearDelta,
            source.event_owner_organization_id,
            refreshFromCatalog
              ? (listing?.registration_url ?? listing?.external_race_url ?? null)
              : (input.registrationUrl ?? source.registration_url_override),
            refreshFromCatalog ? null : (input.street ?? source.street_override),
            refreshFromCatalog ? null : (input.street2 ?? source.street2_override),
            refreshFromCatalog ? null : (input.city ?? source.city_override),
            refreshFromCatalog ? null : (input.state ?? source.state_override),
            refreshFromCatalog ? null : (input.zipcode ?? source.zipcode_override),
            source.timer_location,
            source.hardware_event_name,
            source.scoring_expectations,
            source.post_event_expectations,
            source.operations_notes,
          ],
        )
      ).rows[0];

  if (!occurrence) throw new Error("Could not create the renewed occurrence.");

  if (refreshFromCatalog && listing && openNewEvent) {
    await linkEventToCatalogListing(client, {
      eventId,
      listingId: listing.id,
      occurrenceId: occurrence.id,
      actor: input.actor,
      archiveProspects: true,
    });
  } else if (refreshFromCatalog) {
    await syncOccurrenceRacesFromCatalog(client, occurrence.id);
  } else if (!existing) {
    await copyOccurrenceRacesShifted(
      client,
      source.occurrence_id,
      occurrence.id,
      yearDelta,
    );
  }

  if (!existing) {
    await copyCrewAndCourse(client, source.occurrence_id, occurrence.id);
  }
  await recalculateOccurrenceTimes(client, occurrence.id);

  const booking = await client.query<{ id: string }>(
    `
      INSERT INTO crm.bookings
        (occurrence_id, direct_client_organization_id, primary_contact_person_id,
         stage_id, assigned_user_id, expected_revenue, notes)
      SELECT $1::uuid, $2::uuid, $3::uuid, stage.id, $4::uuid, $5::numeric, $6
      FROM crm.pipeline_stages stage
      WHERE stage.pipeline = 'booking'
        AND stage.key = $7
        AND stage.is_active
      RETURNING id::text
    `,
    [
      occurrence.id,
      source.direct_client_organization_id,
      source.primary_contact_person_id,
      source.assigned_user_id,
      source.expected_revenue,
      source.booking_notes,
      RENEWAL_BOOKING_STAGE_KEY,
    ],
  );
  if (!booking.rows[0]) throw new Error("Booking stage not found.");
  const bookingId = booking.rows[0].id;

  await client.query(
    `
      INSERT INTO crm.booking_prep_items (booking_id, key, label)
      VALUES
        ($1::uuid, 'crew_email_sent', 'Crew email sent'),
        ($1::uuid, 'race_built', 'Race built')
      ON CONFLICT (booking_id, key) DO NOTHING
    `,
    [bookingId],
  );
  await appendAuditActivity(
    client,
    { bookingId },
    input.actor,
    `Renewed from booking ${source.booking_id.slice(0, 8)} for ${input.targetYear}`,
    {
      sourceBookingId: source.booking_id,
      refreshFromCatalog,
      targetYear: input.targetYear,
    },
  );
  await appendAuditActivity(
    client,
    { bookingId: source.booking_id },
    input.actor,
    `Created ${input.targetYear} renewal booking`,
    { renewedBookingId: bookingId, refreshFromCatalog },
  );

  return { bookingId, eventId, occurrenceId: occurrence.id };
}
