import "server-only";

import { getPool } from "@/db";

export type EventListRow = {
  id: string;
  name: string;
  logo_url: string | null;
  owner_name: string | null;
  occurrence_count: number;
  first_year: number | null;
  last_year: number | null;
  next_date: string | null;
};

export type EventListResult = {
  rows: EventListRow[];
  total: number;
  page: number;
  pageSize: number;
};

export type EventDetail = {
  id: string;
  name: string;
  logo_url: string | null;
  website: string | null;
  notes: string | null;
  owner_id: string | null;
  owner_name: string | null;
  catalog_race_listing_id: string | null;
};

export type EventOccurrenceRow = {
  id: string;
  occurrence_year: number | null;
  race_date: string | null;
  location: string;
  client_name: string | null;
  booking_id: string | null;
  booking_stage: string | null;
  client_id: string | null;
  prospect_id: string | null;
  prospect_stage: string | null;
};

export type EventListOptions = {
  page?: number;
  pageSize?: number;
  search?: string | null;
  owner?: string | null;
  yearsMin?: number | null;
  firstYear?: number | null;
  lastYear?: number | null;
  nextFrom?: string | null;
  nextTo?: string | null;
  scope?: "client" | "prospect";
  clientOrganizationIds?: string[] | null;
  sort?: string;
  direction?: "asc" | "desc";
};

function optionalInteger(value: number | null | undefined) {
  return value !== null &&
    value !== undefined &&
    Number.isInteger(value)
    ? value
    : null;
}

export async function listEvents(
  options: EventListOptions = {},
): Promise<EventListResult> {
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(options.pageSize ?? 25)));
  const sortExpressions: Record<string, string> = {
    name: "lower(name)",
    owner: "lower(owner_name)",
    years: "occurrence_count",
    first_year: "first_year",
    last_year: "last_year",
    next_date: "next_date",
  };
  const sort = sortExpressions[options.sort ?? ""] ? options.sort! : "name";
  const direction = options.direction === "desc" ? "DESC" : "ASC";
  const search = options.search?.trim() || null;
  const owner = options.owner?.trim() || null;
  const yearsMin = optionalInteger(options.yearsMin);
  const firstYear = optionalInteger(options.firstYear);
  const lastYear = optionalInteger(options.lastYear);
  const scope = options.scope === "prospect" ? "prospect" : "client";
  const result = await getPool().query<EventListRow & { total: number }>(
    `
      WITH ranked AS (
        SELECT
          event.id::text,
          event.name,
          listing.logo_url,
          owner.name AS owner_name,
          COUNT(occurrence.id)::integer AS occurrence_count,
          MIN(occurrence.occurrence_year) AS first_year,
          MAX(occurrence.occurrence_year) AS last_year,
          MIN(occurrence.race_date)
            FILTER (WHERE occurrence.race_date >= date_trunc('day', now()))
            AS next_date
        FROM crm.events event
        LEFT JOIN crm.organizations owner
          ON owner.id = event.default_owner_organization_id
        LEFT JOIN catalog.race_listings listing
          ON listing.id = event.catalog_race_listing_id
        LEFT JOIN crm.event_occurrences occurrence
          ON occurrence.event_id = event.id
          AND (
            $10::text = 'prospect'
            OR EXISTS (
              SELECT 1
              FROM crm.bookings booking
              WHERE booking.occurrence_id = occurrence.id
                AND booking.archived_at IS NULL
            )
          )
        WHERE event.archived_at IS NULL
          AND (
            (
              $10::text = 'client'
              AND EXISTS (
                SELECT 1
                FROM crm.bookings booking
                JOIN crm.event_occurrences booked
                  ON booked.id = booking.occurrence_id
                WHERE booked.event_id = event.id
                  AND booking.archived_at IS NULL
                  AND (
                    $11::uuid[] IS NULL
                    OR booking.direct_client_organization_id = ANY($11::uuid[])
                  )
              )
            )
            OR (
              $10::text = 'prospect'
              AND NOT EXISTS (
                SELECT 1
                FROM crm.bookings booking
                JOIN crm.event_occurrences booked
                  ON booked.id = booking.occurrence_id
                WHERE booked.event_id = event.id
                  AND booking.archived_at IS NULL
              )
            )
          )
        GROUP BY event.id, owner.name, listing.logo_url
      )
      SELECT *, COUNT(*) OVER()::integer AS total
      FROM ranked
      WHERE ($1::text IS NULL OR name ILIKE '%' || $1::text || '%')
        AND ($2::text IS NULL OR owner_name ILIKE '%' || $2::text || '%')
        AND ($3::integer IS NULL OR occurrence_count >= $3::integer)
        AND ($4::integer IS NULL OR first_year = $4::integer)
        AND ($5::integer IS NULL OR last_year = $5::integer)
        AND ($6::date IS NULL OR next_date >= $6::date)
        AND ($7::date IS NULL OR next_date < ($7::date + 1))
      ORDER BY ${sortExpressions[sort]} ${direction} NULLS LAST, lower(name)
      LIMIT $8 OFFSET $9
    `,
    [
      search,
      owner,
      yearsMin,
      firstYear,
      lastYear,
      options.nextFrom || null,
      options.nextTo || null,
      pageSize,
      (page - 1) * pageSize,
      scope,
      options.clientOrganizationIds ?? null,
    ],
  );
  return {
    rows: result.rows,
    total: result.rows[0]?.total ?? 0,
    page,
    pageSize,
  };
}

export async function getEventDetail(eventId: string) {
  const [event, occurrences] = await Promise.all([
    getPool().query<EventDetail>(
      `
        SELECT event.id::text, event.name, listing.logo_url, event.website, event.notes,
          event.default_owner_organization_id::text AS owner_id,
          owner.name AS owner_name,
          event.catalog_race_listing_id
        FROM crm.events event
        LEFT JOIN crm.organizations owner
          ON owner.id = event.default_owner_organization_id
        LEFT JOIN catalog.race_listings listing
          ON listing.id = event.catalog_race_listing_id
        WHERE event.id = $1::uuid
      `,
      [eventId],
    ),
    getPool().query<EventOccurrenceRow>(
      `
        SELECT
          occurrence.id::text,
          occurrence.occurrence_year,
          occurrence.race_date::text,
          concat_ws(', ',
            NULLIF(COALESCE(NULLIF(occurrence.city_override, ''), listing.city), ''),
            NULLIF(COALESCE(NULLIF(occurrence.state_override, ''), listing.state), '')
          ) AS location,
          COALESCE(client.name, owner.name) AS client_name,
          booking.direct_client_organization_id::text AS client_id,
          booking.id::text AS booking_id,
          booking_stage.name AS booking_stage,
          prospect.id::text AS prospect_id,
          prospect_stage.name AS prospect_stage
        FROM crm.event_occurrences occurrence
        LEFT JOIN crm.events event ON event.id = occurrence.event_id
        LEFT JOIN catalog.race_listings listing
          ON listing.id = event.catalog_race_listing_id
        LEFT JOIN crm.bookings booking ON booking.occurrence_id = occurrence.id
        LEFT JOIN crm.pipeline_stages booking_stage
          ON booking_stage.id = booking.stage_id
        LEFT JOIN crm.organizations client
          ON client.id = booking.direct_client_organization_id
        LEFT JOIN crm.organizations owner
          ON owner.id = occurrence.event_owner_organization_id
        LEFT JOIN crm.prospects prospect ON prospect.occurrence_id = occurrence.id
        LEFT JOIN crm.pipeline_stages prospect_stage
          ON prospect_stage.id = prospect.stage_id
        WHERE occurrence.event_id = $1::uuid
        ORDER BY occurrence.occurrence_year DESC NULLS LAST,
          occurrence.race_date DESC NULLS LAST
      `,
      [eventId],
    ),
  ]);
  return {
    event: event.rows[0] ?? null,
    occurrences: occurrences.rows,
  };
}
