import { getPool } from "@/db";
import {
  buildGoogleCalendarEventResource,
  buildGoogleCalendarTaskEventResource,
  type GoogleCalendarBooking,
  type GoogleCalendarEventResource,
  type GoogleCalendarTaskEventResource,
} from "@/lib/crm/google-calendar";
import { parseRaceScoring } from "@/lib/crm/race-scoring";
import type { EmailMatchTargets } from "@/lib/google/email-match";
import { normalizeEmail } from "@/lib/contact-extraction/extract";

export type EmailMatchIndexEntry = EmailMatchTargets & { email: string };

export async function loadEmailMatchIndex(options?: {
  organizationIds?: string[] | null;
}): Promise<EmailMatchIndexEntry[]> {
  const organizationIds = options?.organizationIds ?? null;
  const result = await getPool().query<{
    email: string;
    prospect_ids: string[] | null;
    booking_ids: string[] | null;
    organization_ids: string[] | null;
    person_ids: string[] | null;
  }>(
    `
      WITH sources AS (
        SELECT lower(method.normalized_value) AS email,
               method.prospect_id,
               method.race_listing_id,
               NULL::uuid AS person_id,
               NULL::uuid AS organization_id
        FROM crm.contact_methods method
        WHERE method.type = 'email'
          AND method.normalized_value LIKE '%@%'
        UNION ALL
        SELECT lower(btrim(person.email)), NULL, NULL, person.id, person.organization_id
        FROM crm.people person
        WHERE person.email IS NOT NULL AND btrim(person.email) <> ''
        UNION ALL
        SELECT lower(btrim(org.email)), NULL, NULL, NULL, org.id
        FROM crm.organizations org
        WHERE org.email IS NOT NULL AND btrim(org.email) <> ''
      ),
      expanded AS (
        SELECT sources.email, prospect.id AS prospect_id, NULL::uuid AS booking_id,
               NULL::uuid AS organization_id, NULL::uuid AS person_id
        FROM sources
        JOIN crm.prospects prospect ON prospect.id = sources.prospect_id
        WHERE prospect.archived_at IS NULL
        UNION
        SELECT sources.email, prospect.id, NULL, NULL, NULL
        FROM sources
        JOIN crm.prospects prospect ON prospect.race_listing_id = sources.race_listing_id
        WHERE sources.race_listing_id IS NOT NULL
          AND prospect.archived_at IS NULL
        UNION
        SELECT sources.email, prospect.id, NULL, NULL, NULL
        FROM sources
        JOIN crm.prospects prospect ON prospect.primary_contact_person_id = sources.person_id
        WHERE sources.person_id IS NOT NULL
          AND prospect.archived_at IS NULL
        UNION
        SELECT sources.email, NULL, booking.id, NULL, NULL
        FROM sources
        JOIN crm.bookings booking ON booking.primary_contact_person_id = sources.person_id
        WHERE sources.person_id IS NOT NULL
          AND booking.archived_at IS NULL
          AND ($1::uuid[] IS NULL OR booking.direct_client_organization_id = ANY($1::uuid[]))
          AND NOT EXISTS (
            SELECT 1
            FROM crm.organizations client_inbox
            WHERE client_inbox.email IS NOT NULL
              AND btrim(client_inbox.email) <> ''
              AND lower(btrim(client_inbox.email)) = sources.email
          )
        UNION
        SELECT sources.email, NULL, booking.id, NULL, NULL
        FROM sources
        JOIN crm.prospects prospect ON prospect.id = sources.prospect_id
        JOIN crm.bookings booking ON booking.id = prospect.converted_booking_id
        WHERE prospect.converted_booking_id IS NOT NULL
          AND booking.archived_at IS NULL
          AND ($1::uuid[] IS NULL OR booking.direct_client_organization_id = ANY($1::uuid[]))
        UNION
        SELECT sources.email, NULL, booking.id, NULL, NULL
        FROM sources
        JOIN crm.prospects prospect
          ON prospect.primary_contact_person_id = sources.person_id
        JOIN crm.bookings booking ON booking.id = prospect.converted_booking_id
        WHERE sources.person_id IS NOT NULL
          AND booking.archived_at IS NULL
          AND ($1::uuid[] IS NULL OR booking.direct_client_organization_id = ANY($1::uuid[]))
        UNION
        SELECT sources.email, NULL, booking.id, NULL, NULL
        FROM sources
        JOIN crm.prospects prospect
          ON prospect.race_listing_id = sources.race_listing_id
        JOIN crm.bookings booking ON booking.id = prospect.converted_booking_id
        WHERE sources.race_listing_id IS NOT NULL
          AND booking.archived_at IS NULL
          AND ($1::uuid[] IS NULL OR booking.direct_client_organization_id = ANY($1::uuid[]))
        UNION
        SELECT sources.email, NULL, NULL, sources.organization_id, NULL
        FROM sources
        WHERE sources.organization_id IS NOT NULL
          AND ($1::uuid[] IS NULL OR sources.organization_id = ANY($1::uuid[]))
        UNION
        SELECT sources.email, NULL, NULL, NULL, sources.person_id
        FROM sources
        WHERE sources.person_id IS NOT NULL
          AND (
            $1::uuid[] IS NULL
            OR sources.organization_id IS NULL
            OR sources.organization_id = ANY($1::uuid[])
          )
      )
      SELECT
        email,
        array_remove(array_agg(DISTINCT prospect_id), NULL)::text[] AS prospect_ids,
        array_remove(array_agg(DISTINCT booking_id), NULL)::text[] AS booking_ids,
        array_remove(array_agg(DISTINCT organization_id), NULL)::text[] AS organization_ids,
        array_remove(array_agg(DISTINCT person_id), NULL)::text[] AS person_ids
      FROM expanded
      GROUP BY email
    `,
    [organizationIds],
  );
  return result.rows.map((row) => ({
    email: normalizeEmail(row.email),
    prospectIds: row.prospect_ids ?? [],
    bookingIds: row.booking_ids ?? [],
    organizationIds: row.organization_ids ?? [],
    personIds: row.person_ids ?? [],
  }));
}

const calendarBookingSql = `
  SELECT
    booking.id::text AS booking_id,
    occurrence.occurrence_year,
    event.name AS event_name,
    COALESCE(booking_link.google_calendar_id, $2) AS calendar_id,
    booking_link.google_event_id,
    booking_link.html_link,
    booking_link.sync_status,
    booking_link.last_error,
    COALESCE(occurrence.arrival_override_at, occurrence.calculated_arrival_at)::text AS start_at,
    COALESCE(occurrence.departure_override_at, occurrence.calculated_departure_at)::text AS end_at,
    CASE WHEN occurrence.timer_location = 'remote' THEN 'Remote'
         ELSE concat_ws(', ',
           NULLIF(COALESCE(occurrence.street_override, listing.street), ''),
           NULLIF(COALESCE(occurrence.street2_override, listing.street2), ''),
           NULLIF(COALESCE(occurrence.city_override, listing.city), ''),
           NULLIF(COALESCE(occurrence.state_override, listing.state), ''),
           NULLIF(COALESCE(occurrence.zipcode_override, listing.zipcode), '')
         )
    END AS location,
    COALESCE(
      occurrence.registration_url_override, event.website,
      listing.registration_url, listing.external_race_url
    ) AS registration_url,
    occurrence.hardware_event_name
  FROM crm.bookings booking
  JOIN crm.event_occurrences occurrence ON occurrence.id = booking.occurrence_id
  JOIN crm.events event ON event.id = occurrence.event_id
  LEFT JOIN catalog.race_listings listing ON listing.id = event.catalog_race_listing_id
  LEFT JOIN crm.google_calendar_links booking_link ON booking_link.booking_id = booking.id
  WHERE booking.archived_at IS NULL
    AND ($1::uuid IS NULL OR booking.id = $1::uuid)
    AND ($3::uuid[] IS NULL OR booking.direct_client_organization_id = ANY($3::uuid[]))
`;

type CalendarBookingRow = {
  booking_id: string;
  occurrence_year: number | null;
  event_name: string;
  calendar_id: string | null;
  google_event_id: string | null;
  html_link: string | null;
  sync_status: string | null;
  last_error: string | null;
  start_at: string | null;
  end_at: string | null;
  location: string | null;
  registration_url: string | null;
  hardware_event_name: string | null;
};

async function attachCalendarDetails(row: CalendarBookingRow): Promise<{
  bookingId: string;
  calendarId: string | null;
  eventId: string | null;
  htmlLink: string | null;
  status: string;
  lastError: string | null;
  event: GoogleCalendarEventResource | null;
  booking: GoogleCalendarBooking;
}> {
  const [crew, races, points] = await Promise.all([
    getPool().query<{
      crew_name: string;
      email: string | null;
      phone: string | null;
      role: string | null;
    }>(
      `
        SELECT COALESCE(person.display_name, person.first_name, crew.freeform_name) AS crew_name,
               person.email, person.phone, crew.role
        FROM crm.crew_assignments crew
        LEFT JOIN crm.people person ON person.id = crew.person_id
        JOIN crm.bookings booking ON booking.occurrence_id = crew.occurrence_id
        WHERE booking.id = $1::uuid
        ORDER BY crew.created_at
      `,
      [row.booking_id],
    ),
    getPool().query<{
      name: string;
      distance_label: string | null;
      start_time: string | null;
      age_groups: string | null;
      awards: string | null;
      scoring: unknown;
    }>(
      `
        SELECT race.name, race.distance_label, race.start_time::text,
               race.age_groups, race.awards, race.scoring
        FROM crm.occurrence_races race
        JOIN crm.bookings booking ON booking.occurrence_id = race.occurrence_id
        WHERE booking.id = $1::uuid
        ORDER BY race.sort_order, race.start_time
      `,
      [row.booking_id],
    ),
    getPool().query<{ name: string; hardware_point_name: string | null }>(
      `
        SELECT point.name, point.hardware_point_name
        FROM crm.course_points point
        JOIN crm.bookings booking ON booking.occurrence_id = point.occurrence_id
        WHERE booking.id = $1::uuid
        ORDER BY point.sort_order
      `,
      [row.booking_id],
    ),
  ]);
  const booking: GoogleCalendarBooking = {
    year: row.occurrence_year,
    eventName: row.event_name,
    startAt: row.start_at ?? "",
    endAt: row.end_at ?? "",
    location: row.location || "Location TBD",
    registrationUrl: row.registration_url,
    hardwareEventName: row.hardware_event_name,
    coursePoints: points.rows.map((point) => ({
      name: point.name,
      hardwarePointName: point.hardware_point_name,
    })),
    crew: crew.rows
      .filter((member) => member.crew_name)
      .map((member) => ({
        name: member.crew_name,
        email: member.email,
        phone: member.phone,
        role: member.role,
      })),
    races: races.rows.map((race) => ({
      name: race.name,
      distanceLabel: race.distance_label,
      startTime: race.start_time,
      ageGroups: race.age_groups,
      awards: race.awards,
      scoring: race.scoring,
      notes: parseRaceScoring(race.scoring).notes,
    })),
  };
  return {
    bookingId: row.booking_id,
    calendarId: row.calendar_id,
    eventId: row.google_event_id,
    htmlLink: row.html_link,
    status: row.sync_status ?? "not_linked",
    lastError: row.last_error,
    event: row.start_at && row.end_at
      ? buildGoogleCalendarEventResource({ ...booking, bookingId: row.booking_id })
      : null,
    booking,
  };
}

export async function loadCalendarPayload(bookingId: string, fallbackCalendarId: string | null) {
  const result = await getPool().query<CalendarBookingRow>(calendarBookingSql, [
    bookingId,
    fallbackCalendarId,
    null,
  ]);
  if (!result.rows[0]) return null;
  return attachCalendarDetails(result.rows[0]);
}

export async function loadPendingCalendarPayloads(
  fallbackCalendarId: string | null,
  organizationIds?: string[] | null,
) {
  const result = await getPool().query<CalendarBookingRow>(
    `${calendarBookingSql}
     AND booking_link.sync_status IN ('needs_sync', 'error')`,
    [null, fallbackCalendarId, organizationIds ?? null],
  );
  return Promise.all(result.rows.map((row) => attachCalendarDetails(row)));
}

export async function loadCalendarLink(bookingId: string) {
  const result = await getPool().query<{
    booking_id: string;
    google_sub: string;
    google_email: string;
    google_calendar_id: string;
    google_event_id: string;
    html_link: string | null;
    sync_status: string;
    last_error: string | null;
    last_synced_at: string | null;
  }>(
    `
      SELECT booking_id::text, google_sub, google_email, google_calendar_id,
             google_event_id, html_link, sync_status::text, last_error,
             last_synced_at::text
      FROM crm.google_calendar_links
      WHERE booking_id = $1::uuid
    `,
    [bookingId],
  );
  return result.rows[0] ?? null;
}

export async function loadTaskCalendarPayload(
  taskId: string,
  fallbackCalendarId: string | null,
) {
  const result = await getPool().query<{
    task_id: string;
    title: string;
    notes: string | null;
    due_at: string;
    race_name: string | null;
    calendar_id: string | null;
    google_event_id: string | null;
    html_link: string | null;
    sync_status: string | null;
    last_error: string | null;
  }>(
    `
      SELECT
        t.id::text AS task_id,
        t.title,
        t.notes,
        t.due_at::text,
        COALESCE(rl.name, prospect_event.name, booking_event.name, organization.name)
          AS race_name,
        COALESCE(task_link.google_calendar_id, $2) AS calendar_id,
        task_link.google_event_id,
        task_link.html_link,
        task_link.sync_status::text,
        task_link.last_error
      FROM crm.tasks t
      LEFT JOIN crm.prospects p ON p.id = t.prospect_id
      LEFT JOIN catalog.race_listings rl ON rl.id = p.race_listing_id
      LEFT JOIN crm.events prospect_event ON prospect_event.id = p.event_id
      LEFT JOIN crm.bookings booking ON booking.id = t.booking_id
      LEFT JOIN crm.event_occurrences occurrence
        ON occurrence.id = booking.occurrence_id
      LEFT JOIN crm.events booking_event ON booking_event.id = occurrence.event_id
      LEFT JOIN crm.organizations organization ON organization.id = t.organization_id
      LEFT JOIN crm.google_task_calendar_links task_link ON task_link.task_id = t.id
      WHERE t.id = $1::uuid
    `,
    [taskId, fallbackCalendarId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const event: GoogleCalendarTaskEventResource | null =
    buildGoogleCalendarTaskEventResource({
      taskId: row.task_id,
      title: row.title,
      notes: row.notes,
      dueAt: row.due_at,
      raceName: row.race_name,
    });
  return {
    taskId: row.task_id,
    calendarId: row.calendar_id,
    eventId: row.google_event_id,
    htmlLink: row.html_link,
    status: row.sync_status ?? "not_linked",
    lastError: row.last_error,
    event,
  };
}

export { markTaskCalendarNeedsSync } from "./task-calendar-sync";
