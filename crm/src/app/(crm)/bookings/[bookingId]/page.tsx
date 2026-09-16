import {
  ArrowLeft,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Flag,
  MapPin,
  Route,
  Users,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  restoreBookingCatalogMatchAction,
  updateBookingEventAction,
  updateBookingFinancialsAction,
  updateBookingRelationshipsAction,
} from "@/app/booking-actions";
import {
  addCoursePointAction,
  deleteCoursePointAction,
  deleteOccurrenceRaceAction,
  saveCoursePointAction,
  saveOccurrenceRaceAction,
  updateOccurrenceOperationsAction,
  updatePrepItemDetailsAction,
  updatePrepItemAction,
} from "@/app/operations-actions";
import {
  permanentlyDeleteBookingAction,
  setBookingArchivedAction,
} from "@/app/lifecycle-actions";
import { ActivityAndTasksFeed } from "@/components/activity-and-tasks-feed";
import { CatalogMatchControls } from "@/components/catalog-match-controls";
import { CollapsibleCard } from "@/components/collapsible-card";
import { RenewBookingDialog } from "@/components/renew-booking-dialog";
import { CopyEventStartTimeButton } from "@/components/copy-event-start-time-button";
import { BookingStagePath } from "@/components/booking-stage-path";
import { EventLogo } from "@/components/event-logo";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { CatalogEventOverview } from "@/components/prospecting/event-overview";
import { ScheduleOverrideEditor } from "@/components/schedule-override-editor";
import { ActivityTimelineItem } from "@/components/activity-timeline-item";
import { CrewAssignmentPanel } from "@/components/crew-assignment-panel";
import { BookingCalendarCard } from "@/components/google/booking-calendar-card";
import { getPool } from "@/db";
import { bookingOrgScopeParam } from "@/lib/auth/access";
import { redactBookingFinancials } from "@/lib/auth/financials";
import { requireOperationsAccess } from "@/lib/auth/server";
import { loadContactOrgScope } from "@/lib/crm/contact-queries";
import { personInContactScopeSql } from "@/lib/crm/contacts";
import { personTaggedToClientOrgSql } from "@/lib/crm/crew";
import { buildActivityTaskFeed } from "@/lib/crm/activity-feed";
import {
  loadCatalogListingCandidates,
  asCatalogQuery,
  resolveCatalogListingQuery,
  suggestCatalogMatches,
} from "@/lib/crm/catalog-link";
import { eventMatchKey } from "@/lib/crm/event-matching";
import { buildGoogleCalendarUrl } from "@/lib/crm/google-calendar";
import { formatTaskHeadline } from "@/lib/crm/domain";
import { getCatalogOverview } from "@/lib/crm/queries";
import { firstParam } from "@/lib/crm/search-params";

type BookingDetail = {
  id: string;
  archived_at: string | null;
  occurrence_id: string;
  occurrence_year: number | null;
  event_id: string;
  event_name: string;
  logo_url: string | null;
  catalog_race_listing_id: string | null;
  catalog_match_dismissed_at: string | null;
  race_date_local: string | null;
  race_date: string | null;
  timezone: string | null;
  registration_url: string | null;
  location: string;
  street: string | null;
  street2: string | null;
  city: string | null;
  state: string | null;
  zipcode: string | null;
  timer_location: string | null;
  direct_client: string;
  direct_client_id: string;
  event_owner: string | null;
  event_owner_id: string | null;
  primary_contact_person_id: string | null;
  primary_contact: string | null;
  assigned_user_id: string | null;
  assignee: string | null;
  stage_key: string;
  expected_revenue: string | null;
  actual_revenue: string | null;
  amount_paid: string | null;
  completed_at: string | null;
  completed_local: string | null;
  payment_due_at: string | null;
  payment_due_local: string | null;
  payment_at: string | null;
  payment_local: string | null;
  notes: string | null;
  source_prospect_id: string | null;
  hardware_event_name: string | null;
  scoring_expectations: string | null;
  post_event_expectations: string | null;
  operations_notes: string | null;
  calculated_arrival_at: string | null;
  arrival_override_at: string | null;
  arrival_override_local: string | null;
  calculated_departure_at: string | null;
  departure_override_at: string | null;
  departure_override_local: string | null;
};

function formatDate(value: string | null, includeTime = false) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    ...(includeTime ? { timeStyle: "short" as const } : {}),
    timeZone: "America/New_York",
  }).format(new Date(value));
}

export default async function BookingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ bookingId: string }>;
  searchParams: Promise<{ edit?: string; listingQ?: string }>;
}) {
  const access = await requireOperationsAccess();
  const contactScope = await loadContactOrgScope(access);
  const { bookingId } = await params;
  const { edit, listingQ } = await searchParams;
  const detail = await getPool().query<BookingDetail>(
    `
      SELECT
        b.id::text,
        b.archived_at::text,
        occurrence.id::text AS occurrence_id,
        occurrence.occurrence_year,
        event.id::text AS event_id,
        event.name AS event_name,
        COALESCE(listing.logo_url, source_listing.logo_url) AS logo_url,
        event.catalog_race_listing_id,
        event.catalog_match_dismissed_at::text,
        occurrence.race_date::text,
        to_char(occurrence.race_date AT TIME ZONE
          COALESCE(occurrence.timezone, 'America/New_York'),
          'YYYY-MM-DD"T"HH24:MI') AS race_date_local,
        COALESCE(occurrence.timezone, listing.timezone, source_listing.timezone) AS timezone,
        COALESCE(occurrence.registration_url_override, listing.registration_url,
                 listing.external_race_url, source_listing.registration_url,
                 source_listing.external_race_url) AS registration_url,
        concat_ws(', ',
          NULLIF(COALESCE(occurrence.street_override, listing.street, source_listing.street), ''),
          NULLIF(COALESCE(occurrence.street2_override, listing.street2, source_listing.street2), ''),
          NULLIF(COALESCE(occurrence.city_override, listing.city, source_listing.city), ''),
          NULLIF(COALESCE(occurrence.state_override, listing.state, source_listing.state), ''),
          NULLIF(COALESCE(occurrence.zipcode_override, listing.zipcode, source_listing.zipcode), '')
        ) AS location,
        COALESCE(occurrence.street_override, listing.street, source_listing.street) AS street,
        COALESCE(occurrence.street2_override, listing.street2, source_listing.street2) AS street2,
        COALESCE(occurrence.city_override, listing.city, source_listing.city) AS city,
        COALESCE(occurrence.state_override, listing.state, source_listing.state) AS state,
        COALESCE(occurrence.zipcode_override, listing.zipcode, source_listing.zipcode) AS zipcode,
        occurrence.timer_location::text,
        client.name AS direct_client,
        client.id::text AS direct_client_id,
        owner.name AS event_owner,
        owner.id::text AS event_owner_id,
        b.primary_contact_person_id::text,
        primary_contact.display_name AS primary_contact,
        b.assigned_user_id::text,
        assignee.name AS assignee,
        stage.key AS stage_key,
        b.expected_revenue::text,
        b.actual_revenue::text,
        b.amount_paid::text,
        b.completed_at::text,
        to_char(b.completed_at AT TIME ZONE 'America/New_York',
          'YYYY-MM-DD"T"HH24:MI') AS completed_local,
        b.payment_due_at::text,
        to_char(b.payment_due_at AT TIME ZONE 'America/New_York',
          'YYYY-MM-DD"T"HH24:MI') AS payment_due_local,
        b.payment_at::text,
        to_char(b.payment_at AT TIME ZONE 'America/New_York',
          'YYYY-MM-DD"T"HH24:MI') AS payment_local,
        b.notes,
        prospect.id::text AS source_prospect_id,
        occurrence.hardware_event_name,
        occurrence.scoring_expectations,
        occurrence.post_event_expectations,
        occurrence.notes AS operations_notes,
        occurrence.calculated_arrival_at::text,
        occurrence.arrival_override_at::text,
        to_char(
          occurrence.arrival_override_at AT TIME ZONE
            COALESCE(occurrence.timezone, 'America/New_York'),
          'YYYY-MM-DD"T"HH24:MI'
        ) AS arrival_override_local,
        occurrence.calculated_departure_at::text,
        occurrence.departure_override_at::text,
        to_char(
          occurrence.departure_override_at AT TIME ZONE
            COALESCE(occurrence.timezone, 'America/New_York'),
          'YYYY-MM-DD"T"HH24:MI'
        ) AS departure_override_local
      FROM crm.bookings b
      JOIN crm.event_occurrences occurrence ON occurrence.id = b.occurrence_id
      JOIN crm.events event ON event.id = occurrence.event_id
      LEFT JOIN catalog.race_listings listing
        ON listing.id = event.catalog_race_listing_id
      JOIN crm.organizations client ON client.id = b.direct_client_organization_id
      LEFT JOIN crm.organizations owner
        ON owner.id = occurrence.event_owner_organization_id
      LEFT JOIN crm.people primary_contact
        ON primary_contact.id = b.primary_contact_person_id
      LEFT JOIN crm.users assignee ON assignee.id = b.assigned_user_id
      JOIN crm.pipeline_stages stage ON stage.id = b.stage_id
      LEFT JOIN crm.prospects prospect ON prospect.converted_booking_id = b.id
      LEFT JOIN catalog.race_listings source_listing
        ON source_listing.id = prospect.race_listing_id
      WHERE b.id = $1::uuid
    `,
    [bookingId],
  );
  const bookingRow = detail.rows[0];
  if (!bookingRow) notFound();
  if (!access.canAccessOrganization(bookingRow.direct_client_id)) notFound();
  const canViewFinancials = access.canViewFinancials(bookingRow.direct_client_id);
  const booking = redactBookingFinancials(bookingRow, canViewFinancials);
  const catalogOverviewPromise = booking.catalog_race_listing_id
    ? getCatalogOverview(booking.catalog_race_listing_id, booking.race_date)
    : Promise.resolve(null);
  const catalogContextPromise =
    !booking.catalog_race_listing_id && !booking.catalog_match_dismissed_at
      ? loadCatalogListingCandidates(
          asCatalogQuery((sql, params) => getPool().query(sql, params)),
          {
            names: [booking.event_name],
            search: firstParam(listingQ)?.trim(),
          },
        )
      : Promise.resolve(null);
  const [stages, activities, tasks, races, coursePoints, crew, prepItems, people,
    crewPeople, organizations, users, catalogOverview, catalogContext, calendarLink] =
    await Promise.all([
    getPool().query<{ key: string; name: string }>(
      `
        SELECT key, name FROM crm.pipeline_stages
        WHERE pipeline = 'booking' AND is_active = true
        ORDER BY sort_order
      `,
    ),
    getPool().query<{
      id: string;
      body: string;
      actor_name: string;
      actor_type: string;
      occurred_at: string;
      type: string;
      metadata: { source?: string; eventType?: string; gmailMessageId?: string; taskId?: string } | null;
    }>(
      `
        SELECT id::text, body, actor_name, actor_type::text, occurred_at::text,
               type::text, metadata
        FROM crm.activities
        WHERE booking_id = $1::uuid
        ORDER BY occurred_at DESC, created_at DESC
      `,
      [bookingId],
    ),
    getPool().query<{
      id: string;
      title: string;
      notes: string | null;
      due_at: string;
      status: "open" | "complete" | "canceled";
    }>(
      `
        SELECT t.id::text, t.title, t.notes, t.due_at::text, t.status::text
        FROM crm.tasks t
        WHERE t.booking_id = $1::uuid
        ORDER BY CASE WHEN t.status = 'open' THEN 0 ELSE 1 END, t.due_at ASC
      `,
      [bookingId],
    ),
    getPool().query<{
      id: string;
      name: string;
      distance_label: string | null;
      distance_miles: string | null;
      distance_meters: number | null;
      start_time: string | null;
      age_groups: string | null;
      awards: string | null;
      estimated_duration_minutes: number | null;
      duration_override_minutes: number | null;
    }>(
      `
        SELECT id::text, name, distance_label, distance_miles::text,
          distance_meters, start_time::text, age_groups, awards,
          estimated_duration_minutes, duration_override_minutes
        FROM crm.occurrence_races
        WHERE occurrence_id = $1::uuid
        ORDER BY sort_order, start_time
      `,
      [booking.occurrence_id],
    ),
    getPool().query<{
      id: string;
      name: string;
      hardware_point_name: string | null;
      notes: string | null;
    }>(
      `
        SELECT id::text, name, hardware_point_name, notes
        FROM crm.course_points
        WHERE occurrence_id = $1::uuid
        ORDER BY sort_order
      `,
      [booking.occurrence_id],
    ),
    getPool().query<{
      id: string;
      crew_name: string;
      person_id: string | null;
      freeform_name: string | null;
      role: string | null;
      notes: string | null;
      email: string | null;
      phone: string | null;
    }>(
      `
        SELECT assignment.id::text,
          COALESCE(person.display_name, assignment.freeform_name) AS crew_name,
          assignment.person_id::text, assignment.freeform_name,
          assignment.role, assignment.notes, person.email, person.phone
        FROM crm.crew_assignments assignment
        LEFT JOIN crm.people person ON person.id = assignment.person_id
        WHERE assignment.occurrence_id = $1::uuid
        ORDER BY crew_name
      `,
      [booking.occurrence_id],
    ),
    getPool().query<{
      id: string;
      key: string;
      label: string;
      status: "pending" | "complete" | "not_applicable";
      notes: string | null;
    }>(
      `
        SELECT id::text, key, label, status::text, notes
        FROM crm.booking_prep_items
        WHERE booking_id = $1::uuid
        ORDER BY CASE key WHEN 'crew_email_sent' THEN 1 ELSE 2 END
      `,
      [bookingId],
    ),
    getPool().query<{
      id: string;
      display_name: string;
      email: string | null;
      phone: string | null;
    }>(
      `
        SELECT person.id::text,
          COALESCE(
            NULLIF(person.display_name, ''),
            NULLIF(trim(concat_ws(' ', person.first_name, person.last_name)), ''),
            person.email,
            'Unnamed contact'
          ) AS display_name,
          person.email,
          person.phone
        FROM crm.people person
        WHERE person.is_active = true AND person.archived_at IS NULL
          AND ${personInContactScopeSql(1, 2)}
        ORDER BY display_name
      `,
      [contactScope.scopeOrgIds, contactScope.assignedOrgIds],
    ),
    getPool().query<{
      id: string;
      display_name: string;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      phone: string | null;
    }>(
      `
        SELECT person.id::text,
          COALESCE(
            NULLIF(person.display_name, ''),
            NULLIF(trim(concat_ws(' ', person.first_name, person.last_name)), ''),
            person.email,
            'Unnamed contact'
          ) AS display_name,
          person.first_name,
          person.last_name,
          person.email,
          person.phone
        FROM crm.people person
        WHERE person.is_active = true AND person.archived_at IS NULL
          AND ${personTaggedToClientOrgSql("$1::uuid")}
        ORDER BY display_name
      `,
      [booking.direct_client_id],
    ),
    getPool().query<{ id: string; name: string }>(
      `SELECT id::text, name FROM crm.organizations
       WHERE is_active AND archived_at IS NULL
         AND ($1::uuid[] IS NULL OR id = ANY($1::uuid[]))
       ORDER BY name`,
      [bookingOrgScopeParam(access)],
    ),
    getPool().query<{ id: string; name: string }>(
      `SELECT id::text, name FROM crm.users WHERE is_active ORDER BY name`,
    ),
    catalogOverviewPromise,
    catalogContextPromise,
    getPool().query<{
      google_calendar_id: string;
      google_event_id: string;
      html_link: string | null;
      sync_status: string;
      last_error: string | null;
      last_synced_at: string | null;
      google_email: string;
    }>(
      `
        SELECT google_calendar_id, google_event_id, html_link, sync_status::text,
               last_error, last_synced_at::text, google_email
        FROM crm.google_calendar_links
        WHERE booking_id = $1::uuid
      `,
      [bookingId],
    ),
  ]);
  const listingQuery = firstParam(listingQ)?.trim() || "";
  let catalogSuggestions: ReturnType<typeof suggestCatalogMatches> = [];
  let catalogSearchResults: ReturnType<typeof suggestCatalogMatches> = [];
  if (catalogContext) {
    catalogSuggestions = suggestCatalogMatches(
      {
        name: booking.event_name,
        city: booking.city,
        state: booking.state,
      },
      catalogContext.listings,
      { takenIds: catalogContext.takenIds },
    );
    if (listingQuery) {
      const resolved = resolveCatalogListingQuery(
        listingQuery,
        catalogContext.listings,
        catalogContext.takenIds,
      );
      const rows =
        "match" in resolved && resolved.match
          ? [resolved.match]
          : "matches" in resolved
            ? resolved.matches
            : [];
      const eventKey = eventMatchKey(booking.event_name);
      catalogSearchResults = rows.map((listing) => ({
        ...listing,
        score: eventMatchKey(listing.name) === eventKey ? 100 : 50,
        reason:
          eventMatchKey(listing.name) === eventKey
            ? ("exact" as const)
            : ("similar" as const),
      }));
    }
  }
  const effectiveArrival =
    booking.arrival_override_at ?? booking.calculated_arrival_at;
  const effectiveDeparture =
    booking.departure_override_at ?? booking.calculated_departure_at;
  const calendarUrl =
    effectiveArrival && effectiveDeparture
      ? buildGoogleCalendarUrl({
          year: booking.occurrence_year,
          eventName: booking.event_name,
          startAt: effectiveArrival,
          endAt: effectiveDeparture,
          location:
            booking.timer_location === "remote"
              ? "Remote"
              : booking.location || "Location TBD",
          registrationUrl: booking.registration_url,
          crew: crew.rows.map((member) => ({
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
          })),
        })
      : null;
  const feed = buildActivityTaskFeed(activities.rows, tasks.rows);
  const activityById = new Map(activities.rows.map((activity) => [activity.id, activity]));
  const taskById = new Map(tasks.rows.map((task) => [task.id, task]));
  const feedActivityCount = feed.filter((item) => item.kind === "activity").length;

  return (
    <div className="space-y-6">
      <Link href="/bookings" className="inline-flex items-center gap-2 text-sm font-medium text-slate-600">
        <ArrowLeft className="size-4" /> Back to bookings
      </Link>
      <header className="rounded-2xl bg-slate-950 p-6 text-white">
        <p className="text-sm font-semibold uppercase tracking-wider text-cyan-300">Booking</p>
        <h1 className="mt-1 flex items-center gap-3 text-3xl font-bold">
          <EventLogo
            url={booking.logo_url}
            name={booking.event_name}
            size="header"
            tone="dark"
          />
          <Link href={`/events/${booking.event_id}`} className="hover:text-cyan-300">
            {booking.event_name}
          </Link>
        </h1>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-5 text-sm text-slate-300">
            <span className="inline-flex items-center gap-2">
              <CalendarDays className="size-4" />
              {booking.race_date ? formatDate(booking.race_date, true) : "Date TBD"}
            </span>
            <span className="inline-flex items-center gap-2">
              <MapPin className="size-4" /> {booking.location || "Location TBD"}
            </span>
          </div>
          <RenewBookingDialog
            bookingId={booking.id}
            eventName={booking.event_name}
            raceDateLocal={booking.race_date_local}
            occurrenceYear={booking.occurrence_year}
            timezone={booking.timezone ?? "America/New_York"}
            registrationUrl={booking.registration_url}
            street={booking.street}
            street2={booking.street2}
            city={booking.city}
            state={booking.state}
            zipcode={booking.zipcode}
            catalogLinked={Boolean(booking.catalog_race_listing_id)}
          />
        </div>
        <BookingCalendarCard
          bookingId={booking.id}
          link={calendarLink.rows[0] ?? null}
          canCreate={Boolean(calendarUrl)}
          templateUrl={calendarUrl}
        />
      </header>

      <BookingStagePath
        bookingId={booking.id}
        currentStageKey={booking.stage_key}
        stages={stages.rows}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-slate-950">Event details</h2>
              {edit === "event" ? (
                <Link href={`/bookings/${booking.id}`} className="text-sm font-semibold text-slate-600">Cancel</Link>
              ) : (
                <Link href={`/bookings/${booking.id}?edit=event`} className="text-sm font-semibold text-cyan-700">Edit</Link>
              )}
            </div>
            {edit === "event" ? (
              <form action={updateBookingEventAction} className="mt-4 grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="bookingId" value={booking.id} />
                <input type="hidden" name="occurrenceId" value={booking.occurrence_id} />
                <label className="text-sm sm:col-span-2">Event name<input required name="eventName" defaultValue={booking.event_name} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
                <label className="text-sm">Date and time<input type="datetime-local" name="raceDate" defaultValue={booking.race_date_local ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
                <label className="text-sm">Timezone<input required name="timezone" defaultValue={booking.timezone ?? "America/New_York"} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
                <label className="text-sm sm:col-span-2">Registration URL<input type="url" name="registrationUrl" defaultValue={booking.registration_url ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
                <label className="text-sm sm:col-span-2">Street<input name="street" defaultValue={booking.street ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
                <label className="text-sm">Street 2<input name="street2" defaultValue={booking.street2 ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
                <label className="text-sm">City<input name="city" defaultValue={booking.city ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
                <label className="text-sm">State<input name="state" defaultValue={booking.state ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
                <label className="text-sm">ZIP code<input name="zipcode" defaultValue={booking.zipcode ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
                <PendingSubmitButton className="rounded-lg bg-cyan-700 px-4 py-2 font-semibold text-white sm:col-span-2">Save event details</PendingSubmitButton>
              </form>
            ) : (
              <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                <div><dt className="text-xs uppercase text-slate-500">Date and time</dt><dd className="font-medium">{formatDate(booking.race_date, true)}</dd></div>
                <div><dt className="text-xs uppercase text-slate-500">Timezone</dt><dd className="font-medium">{booking.timezone ?? "Not set"}</dd></div>
                <div className="sm:col-span-2"><dt className="text-xs uppercase text-slate-500">Address</dt><dd className="font-medium">{booking.location || "Not set"}</dd></div>
                <div className="sm:col-span-2"><dt className="text-xs uppercase text-slate-500">Registration</dt><dd>{booking.registration_url ? <a className="text-cyan-700 underline" href={booking.registration_url}>Open registration page</a> : "Not set"}</dd></div>
              </dl>
            )}
            {catalogOverview?.listing ? (
              <CatalogEventOverview
                listing={{
                  catalog_slug: catalogOverview.listing.catalog_slug,
                  description_html: catalogOverview.listing.description_html,
                  quick_take: catalogOverview.listing.quick_take,
                  city: catalogOverview.listing.city,
                  state: catalogOverview.listing.state,
                  timezone: catalogOverview.listing.timezone ?? booking.timezone,
                  event_date: booking.race_date,
                  event_date_local: booking.race_date_local,
                  source_provider: catalogOverview.listing.source_provider,
                  registration_url: catalogOverview.listing.registration_url,
                  external_race_url: catalogOverview.listing.external_race_url,
                }}
                tags={catalogOverview.tags}
                offerings={catalogOverview.offerings}
                variant="embedded"
                resync={{
                  bookingId: booking.id,
                  occurrenceId: booking.occurrence_id,
                }}
                uncouple={{ bookingId: booking.id }}
              />
            ) : booking.catalog_match_dismissed_at ? (
              <div
                id="catalog-match"
                className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4"
              >
                <h3 className="text-sm font-semibold text-amber-950">
                  Marked as not in the catalog
                </h3>
                <p className="mt-1 text-sm text-amber-900">
                  Undo that if it was a mistake, then search by name or location
                  and match the listing. Event details and the logo will sync
                  the same way as other catalog links.
                </p>
                <form action={restoreBookingCatalogMatchAction} className="mt-3">
                  <input type="hidden" name="bookingId" value={booking.id} />
                  <PendingSubmitButton
                    pendingLabel="Opening matcher…"
                    className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-800 disabled:opacity-60"
                  >
                    Match catalog listing
                  </PendingSubmitButton>
                </form>
              </div>
            ) : (
              <div id="catalog-match" className="mt-5 border-t border-slate-200 pt-5">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Match catalog listing
                </h3>
                <p className="mt-1 mb-3 text-sm text-slate-600">
                  Search Get Run Vibes or Race Roster by name, location, or year,
                  then match so event details and the logo fill in from the catalog.
                </p>
                <CatalogMatchControls
                  bookingId={booking.id}
                  suggestions={catalogSuggestions}
                  searchResults={catalogSearchResults}
                  searchQuery={listingQuery}
                />
              </div>
            )}
            {booking.source_prospect_id && access.canAccessProspecting ? (
              <Link href={`/prospecting/${booking.source_prospect_id}`} className="mt-5 inline-block text-sm font-semibold text-cyan-700">
                View original prospect history
              </Link>
            ) : null}
          </section>

          <CollapsibleCard title="Client & financials">
            <div className="space-y-6">
              <div>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-bold text-slate-950">Client and ownership</h3>
                  {edit === "relationships" ? (
                    <Link href={`/bookings/${booking.id}`} className="text-sm font-semibold text-slate-600">Cancel</Link>
                  ) : (
                    <Link href={`/bookings/${booking.id}?edit=relationships`} className="text-sm font-semibold text-cyan-700">Edit</Link>
                  )}
                </div>
                {edit === "relationships" ? (
                  <form action={updateBookingRelationshipsAction} className="mt-4 grid gap-3 sm:grid-cols-2">
                    <input type="hidden" name="bookingId" value={booking.id} />
                    <input type="hidden" name="occurrenceId" value={booking.occurrence_id} />
                    <label className="text-sm">Direct client<select required name="directClientId" defaultValue={booking.direct_client_id} className="mt-1 w-full rounded-lg border px-3 py-2">{organizations.rows.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                    <label className="text-sm">Event owner<select name="eventOwnerId" defaultValue={booking.event_owner_id ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2"><option value="">None</option>{organizations.rows.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                    <label className="text-sm">Primary contact<select name="primaryContactPersonId" defaultValue={booking.primary_contact_person_id ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2"><option value="">None</option>{people.rows.map((item) => <option key={item.id} value={item.id}>{item.display_name}</option>)}</select></label>
                    <label className="text-sm">Assignee<select name="assignedUserId" defaultValue={booking.assigned_user_id ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2"><option value="">Unassigned</option>{users.rows.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                    <PendingSubmitButton className="rounded-lg bg-cyan-700 px-4 py-2 font-semibold text-white sm:col-span-2">Save relationships</PendingSubmitButton>
                  </form>
                ) : (
                  <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div><dt className="text-xs uppercase text-slate-500">Direct client</dt><dd className="font-medium">{booking.direct_client}</dd></div>
                    <div><dt className="text-xs uppercase text-slate-500">Event owner</dt><dd className="font-medium">{booking.event_owner ?? "Not set"}</dd></div>
                    <div><dt className="text-xs uppercase text-slate-500">Primary contact</dt><dd className="font-medium">{booking.primary_contact ?? "Not set"}</dd></div>
                    <div><dt className="text-xs uppercase text-slate-500">Assignee</dt><dd className="font-medium">{booking.assignee ?? "Unassigned"}</dd></div>
                  </dl>
                )}
              </div>
              <div className="border-t border-slate-200 pt-5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-bold text-slate-950">Financials</h3>
                  {canViewFinancials ? (
                    edit === "financials" ? (
                    <Link href={`/bookings/${booking.id}`} className="text-sm font-semibold text-slate-600">Cancel</Link>
                  ) : (
                    <Link href={`/bookings/${booking.id}?edit=financials`} className="text-sm font-semibold text-cyan-700">Edit</Link>
                  )
                  ) : null}
                </div>
                {canViewFinancials && edit === "financials" ? (
                  <form action={updateBookingFinancialsAction} className="mt-4 grid gap-4 sm:grid-cols-3">
                    <input type="hidden" name="bookingId" value={booking.id} />
                    <label className="text-sm">Expected revenue<input name="expectedRevenue" defaultValue={booking.expected_revenue ?? ""} inputMode="decimal" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
                    <label className="text-sm">Actual revenue<input name="actualRevenue" defaultValue={booking.actual_revenue ?? ""} inputMode="decimal" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
                    <label className="text-sm">Amount paid<input name="amountPaid" defaultValue={booking.amount_paid ?? ""} inputMode="decimal" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
                    <label className="text-sm">Completed<input type="datetime-local" name="completedAt" defaultValue={booking.completed_local ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
                    <label className="text-sm">Payment due<input type="datetime-local" name="paymentDueAt" defaultValue={booking.payment_due_local ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
                    <label className="text-sm">Paid<input type="datetime-local" name="paymentAt" defaultValue={booking.payment_local ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
                    <label className="text-sm sm:col-span-3">Notes<textarea name="notes" defaultValue={booking.notes ?? ""} rows={4} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
                    <PendingSubmitButton className="rounded-lg bg-cyan-700 px-4 py-2 font-semibold text-white sm:col-span-3">Save financials</PendingSubmitButton>
                  </form>
                ) : canViewFinancials ? (
                  <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                    <div><dt className="text-slate-500">Expected</dt><dd>{booking.expected_revenue ?? "—"}</dd></div>
                    <div><dt className="text-slate-500">Actual</dt><dd>{booking.actual_revenue ?? "—"}</dd></div>
                    <div><dt className="text-slate-500">Paid amount</dt><dd>{booking.amount_paid ?? "—"}</dd></div>
                    <div><dt className="text-slate-500">Completed</dt><dd>{formatDate(booking.completed_at)}</dd></div>
                    <div><dt className="text-slate-500">Payment due</dt><dd>{formatDate(booking.payment_due_at)}</dd></div>
                    <div><dt className="text-slate-500">Paid</dt><dd>{formatDate(booking.payment_at)}</dd></div>
                  </dl>
                ) : (
                  <p className="mt-4 text-sm text-slate-500">
                    Financial details are hidden for org users.
                  </p>
                )}
              </div>
            </div>
          </CollapsibleCard>

          <CollapsibleCard
            title="Race-day operations"
            icon={<Clock3 className="size-5 text-cyan-700" />}
          >
            <div className="grid gap-6 lg:grid-cols-2">
              <form action={updateOccurrenceOperationsAction} className="grid content-start gap-4">
                <input type="hidden" name="bookingId" value={booking.id} />
                <input type="hidden" name="occurrenceId" value={booking.occurrence_id} />
                <ScheduleOverrideEditor
                  arrivalDisplay={formatDate(effectiveArrival, true)}
                  departureDisplay={formatDate(effectiveDeparture, true)}
                  arrivalOverridden={Boolean(booking.arrival_override_at)}
                  departureOverridden={Boolean(booking.departure_override_at)}
                  arrivalOverrideLocal={booking.arrival_override_local}
                  departureOverrideLocal={booking.departure_override_local}
                />
                <label className="text-sm">Timer location
                  <select name="timerLocation" defaultValue={booking.timer_location ?? ""} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
                    <option value="">Not set</option>
                    <option value="on_site">On-Site</option>
                    <option value="remote">Remote</option>
                  </select>
                </label>
                <label className="text-sm">Hardware event name<input name="hardwareEventName" defaultValue={booking.hardware_event_name ?? ""} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
                <label className="text-sm">Scoring/support expectations<textarea name="scoringExpectations" defaultValue={booking.scoring_expectations ?? ""} rows={3} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
                <label className="text-sm">Post-event expectations<textarea name="postEventExpectations" defaultValue={booking.post_event_expectations ?? ""} rows={3} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
                <label className="text-sm">Operations notes<textarea name="operationsNotes" defaultValue={booking.operations_notes ?? ""} rows={3} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
                <PendingSubmitButton className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white">Save operations</PendingSubmitButton>
              </form>
              <div>
                <h3 className="flex items-center gap-2 text-sm font-bold text-slate-950">
                  <Route className="size-4 text-cyan-700" /> Course points
                </h3>
                <div className="mt-3 space-y-2">
                  {coursePoints.rows.map((point) => (
                    <details key={point.id} className="rounded-lg bg-slate-50 p-3 text-sm">
                      <summary className="cursor-pointer"><strong>{point.name}</strong>{point.hardware_point_name ? ` · ${point.hardware_point_name}` : ""}</summary>
                      <form action={saveCoursePointAction} className="mt-3 space-y-2">
                        <input type="hidden" name="bookingId" value={booking.id} />
                        <input type="hidden" name="occurrenceId" value={booking.occurrence_id} />
                        <input type="hidden" name="pointId" value={point.id} />
                        <label className="block">Point name<input required name="name" defaultValue={point.name} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
                        <label className="block">Hardware name<input name="hardwarePointName" defaultValue={point.hardware_point_name ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
                        <label className="block">Notes<input name="notes" defaultValue={point.notes ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
                        <PendingSubmitButton className="font-semibold text-cyan-700">Save course point</PendingSubmitButton>
                      </form>
                      <form action={deleteCoursePointAction} className="mt-2">
                        <input type="hidden" name="bookingId" value={booking.id} />
                        <input type="hidden" name="occurrenceId" value={booking.occurrence_id} />
                        <input type="hidden" name="pointId" value={point.id} />
                        <button className="font-semibold text-red-700">Remove</button>
                      </form>
                    </details>
                  ))}
                  {!coursePoints.rows.length ? <p className="text-sm text-slate-500">No course points added.</p> : null}
                </div>
                <form action={addCoursePointAction} className="mt-4 space-y-3 border-t pt-4">
                  <input type="hidden" name="bookingId" value={booking.id} />
                  <input type="hidden" name="occurrenceId" value={booking.occurrence_id} />
                  <label className="block text-sm">Point name<input required name="name" placeholder="Finish" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
                  <label className="block text-sm">Hardware point name<input name="hardwarePointName" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
                  <label className="block text-sm">Notes<input name="notes" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
                  <button className="w-full rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white">Add course point</button>
                </form>
              </div>
            </div>
          </CollapsibleCard>

          <CollapsibleCard
            title="Races"
            icon={<Flag className="size-5 text-cyan-700" />}
          >
            <div className="space-y-3">
              {races.rows.map((race) => (
                <details key={race.id} className="rounded-xl border border-slate-200 p-4">
                  <summary className="cursor-pointer font-semibold">
                    {race.name} · {race.start_time?.slice(0, 16).replace("T", " ") ?? "Start TBD"}
                    <span className="ml-2 text-sm font-normal text-slate-500">
                      {race.duration_override_minutes ?? race.estimated_duration_minutes ?? "?"} min
                    </span>
                  </summary>
                  <form action={saveOccurrenceRaceAction} className="mt-4 grid gap-3 sm:grid-cols-2">
                    <input type="hidden" name="bookingId" value={booking.id} />
                    <input type="hidden" name="occurrenceId" value={booking.occurrence_id} />
                    <input type="hidden" name="raceId" value={race.id} />
                    <label className="text-sm">Name<input required name="name" defaultValue={race.name} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
                    <label className="text-sm">Distance label<input name="distanceLabel" defaultValue={race.distance_label ?? ""} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
                    <div>
                      <span className="flex items-center justify-between gap-2 text-sm">
                        Start time
                        <CopyEventStartTimeButton eventStartLocal={booking.race_date_local} />
                      </span>
                      <input required type="datetime-local" name="startTime" defaultValue={race.start_time?.slice(0, 16) ?? ""} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
                    </div>
                    <label className="text-sm">Duration override (minutes)<input type="number" min="1" name="durationOverrideMinutes" defaultValue={race.duration_override_minutes ?? ""} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
                    <label className="text-sm">Miles<input type="number" min="0" step="0.001" name="distanceMiles" defaultValue={race.distance_miles ?? ""} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
                    <label className="text-sm">Meters<input type="number" min="1" name="distanceMeters" defaultValue={race.distance_meters ?? ""} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
                    <label className="text-sm sm:col-span-2">Age groups<textarea name="ageGroups" defaultValue={race.age_groups ?? ""} rows={5} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
                    <label className="text-sm sm:col-span-2">Awards<textarea name="awards" defaultValue={race.awards ?? ""} rows={5} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
                    <PendingSubmitButton className="rounded-lg bg-cyan-700 px-4 py-2 font-semibold text-white sm:col-span-2">Save race</PendingSubmitButton>
                  </form>
                  <form action={deleteOccurrenceRaceAction} className="mt-2">
                    <input type="hidden" name="bookingId" value={booking.id} />
                    <input type="hidden" name="occurrenceId" value={booking.occurrence_id} />
                    <input type="hidden" name="raceId" value={race.id} />
                    <button className="text-sm font-semibold text-red-700">Remove race</button>
                  </form>
                </details>
              ))}
            </div>
            <details className="mt-4 rounded-xl bg-cyan-50 p-4">
              <summary className="cursor-pointer font-semibold text-cyan-950">+ Add Race</summary>
              <form action={saveOccurrenceRaceAction} className="mt-4 grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="bookingId" value={booking.id} />
                <input type="hidden" name="occurrenceId" value={booking.occurrence_id} />
                <label className="text-sm">Name<input required name="name" className="mt-1 w-full rounded-lg border border-cyan-200 px-3 py-2" /></label>
                <label className="text-sm">Distance label<input name="distanceLabel" placeholder="5K" className="mt-1 w-full rounded-lg border border-cyan-200 px-3 py-2" /></label>
                <div>
                  <span className="flex items-center justify-between gap-2 text-sm">
                    Start time
                    <CopyEventStartTimeButton eventStartLocal={booking.race_date_local} />
                  </span>
                  <input required type="datetime-local" name="startTime" className="mt-1 w-full rounded-lg border border-cyan-200 px-3 py-2" />
                </div>
                <label className="text-sm">Duration override (minutes)<input type="number" min="1" name="durationOverrideMinutes" className="mt-1 w-full rounded-lg border border-cyan-200 px-3 py-2" /></label>
                <label className="text-sm">Miles<input type="number" min="0" step="0.001" name="distanceMiles" className="mt-1 w-full rounded-lg border border-cyan-200 px-3 py-2" /></label>
                <label className="text-sm">Meters<input type="number" min="1" name="distanceMeters" className="mt-1 w-full rounded-lg border border-cyan-200 px-3 py-2" /></label>
                <label className="text-sm sm:col-span-2">Age groups<textarea name="ageGroups" rows={5} className="mt-1 w-full rounded-lg border border-cyan-200 px-3 py-2" /></label>
                <label className="text-sm sm:col-span-2">Awards<textarea name="awards" rows={5} className="mt-1 w-full rounded-lg border border-cyan-200 px-3 py-2" /></label>
                <button className="rounded-lg bg-cyan-700 px-4 py-2 font-semibold text-white sm:col-span-2">Add race</button>
              </form>
            </details>
          </CollapsibleCard>

          <CollapsibleCard
            title="Crew"
            icon={<Users className="size-5 text-cyan-700" />}
          >
            <CrewAssignmentPanel
              bookingId={booking.id}
              occurrenceId={booking.occurrence_id}
              clientOrganizationId={booking.direct_client_id}
              clientOrganizationName={booking.direct_client}
              assigned={crew.rows.map((member) => ({
                id: member.id,
                personId: member.person_id,
                name: member.crew_name,
                email: member.email,
                phone: member.phone,
                role: member.role,
                freeformName: member.freeform_name,
                notes: member.notes,
              }))}
              people={crewPeople.rows.map((person) => ({
                id: person.id,
                displayName: person.display_name,
                firstName: person.first_name,
                lastName: person.last_name,
                email: person.email,
                phone: person.phone,
              }))}
            />
          </CollapsibleCard>

          <ActivityAndTasksFeed
            taskCount={tasks.rows.length}
            activityCount={feedActivityCount}
          >
            {feed.map((item) => {
              if (item.kind === "task") {
                const task = taskById.get(item.id);
                if (!task) return null;
                return (
                  <article
                    key={`task-${task.id}`}
                    data-feed-kind="task"
                    className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm"
                  >
                    <p className="flex flex-wrap items-center gap-2 font-semibold">
                      <CalendarClock aria-hidden className="size-4 text-cyan-700" />
                      Task · {formatTaskHeadline(task.title, task.notes)}
                    </p>
                    <p className="mt-1 text-slate-500">
                      {formatDate(task.due_at, true)} · {task.status}
                    </p>
                    {task.notes && formatTaskHeadline(task.title, task.notes) === task.title ? (
                      <p className="mt-1 whitespace-pre-wrap text-slate-700">{task.notes}</p>
                    ) : null}
                  </article>
                );
              }
              const activity = activityById.get(item.id);
              if (!activity) return null;
              return (
                <div key={`activity-${activity.id}`} data-feed-kind="activity">
                  <ActivityTimelineItem activity={activity} />
                </div>
              );
            })}
          </ActivityAndTasksFeed>
        </div>

        <aside className="space-y-5">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="flex items-center gap-2 font-bold">
              <CheckCircle2 className="size-5 text-cyan-700" /> Pre-event prep
            </h2>
            <div className="mt-4 space-y-4">
              {prepItems.rows.map((item) => (
                <div key={item.id} className="rounded-lg border border-slate-100 p-3">
                <form action={updatePrepItemAction}>
                  <input type="hidden" name="bookingId" value={booking.id} />
                  <input type="hidden" name="itemId" value={item.id} />
                  <label className="block text-sm font-medium">
                    {item.label}
                    <select key={item.status} name="status" defaultValue={item.status} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
                      <option value="pending">Pending</option>
                      <option value="complete">Complete</option>
                      <option value="not_applicable">Not Applicable</option>
                    </select>
                  </label>
                  <PendingSubmitButton className="mt-2 text-sm font-semibold text-cyan-700">Save</PendingSubmitButton>
                </form>
                <details className="mt-2 text-sm">
                  <summary className="cursor-pointer text-slate-500">Edit item details</summary>
                  <form action={updatePrepItemDetailsAction} className="mt-2 space-y-2">
                    <input type="hidden" name="bookingId" value={booking.id} />
                    <input type="hidden" name="itemId" value={item.id} />
                    <label className="block">Label<input required name="label" defaultValue={item.label} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
                    <label className="block">Notes<textarea name="notes" defaultValue={item.notes ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
                    <PendingSubmitButton className="font-semibold text-cyan-700">Save details</PendingSubmitButton>
                  </form>
                </details>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Both items must be complete or not applicable before Ready.
            </p>
          </section>
        </aside>
      </div>
      <section className="rounded-xl border border-red-200 bg-red-50 p-5">
        <h2 className="font-bold text-red-950">Danger zone</h2>
        {booking.archived_at ? (
          <div className="mt-3 space-y-4">
            <form action={setBookingArchivedAction}>
              <input type="hidden" name="bookingId" value={booking.id} />
              <input type="hidden" name="operation" value="restore" />
              <button className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-semibold">Restore booking</button>
            </form>
            <form action={permanentlyDeleteBookingAction} className="space-y-2">
              <label className="block text-sm">Type DELETE to permanently remove eligible CRM-owned data.
                <input required name="confirmation" className="mt-1 block rounded-lg border border-red-300 px-3 py-2" />
              </label>
              <input type="hidden" name="bookingId" value={booking.id} />
              <button className="rounded-lg bg-red-700 px-4 py-2 font-semibold text-white">Permanently delete</button>
            </form>
          </div>
        ) : (
          <form action={setBookingArchivedAction} className="mt-3">
            <input type="hidden" name="bookingId" value={booking.id} />
            <input type="hidden" name="operation" value="archive" />
            <button className="rounded-lg bg-red-700 px-4 py-2 font-semibold text-white">Archive booking</button>
          </form>
        )}
      </section>
    </div>
  );
}
