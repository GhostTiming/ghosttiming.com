import { CalendarDays, Columns3, List, WalletCards } from "lucide-react";
import Link from "next/link";
import { CatalogMatchControls } from "@/components/catalog-match-controls";
import { EventLogo } from "@/components/event-logo";
import { ListRowActions, ListRowLink } from "@/components/list-row";
import { listRowClassName } from "@/components/list-row-class";
import { TableColumnHeader } from "@/components/table-column-header";
import { getPool } from "@/db";
import { bookingOrgScopeParam } from "@/lib/auth/access";
import { redactBookingFinancials } from "@/lib/auth/financials";
import { requireOperationsAccess } from "@/lib/auth/server";
import {
  autoLinkUniqueCatalogMatches,
  asCatalogQuery,
  loadCatalogListingCandidates,
  suggestCatalogMatches,
} from "@/lib/crm/catalog-link";
import { buildSearchHref, firstParam } from "@/lib/crm/search-params";

type BookingRow = {
  id: string;
  event_id: string;
  event_name: string;
  logo_url: string | null;
  race_date: string | null;
  city: string | null;
  state: string | null;
  location: string;
  direct_client: string;
  direct_client_id: string;
  stage_key: string;
  stage_name: string;
  timer_location: "on_site" | "remote" | null;
  expected_revenue: string | null;
  actual_revenue: string | null;
  amount_paid: string | null;
  payment_at: string | null;
};

type BookingParams = {
  view?: string | string[];
  stage?: string | string[];
  q?: string | string[];
  client?: string | string[];
  dateFrom?: string | string[];
  dateTo?: string | string[];
  payment?: string | string[];
  sort?: string | string[];
  direction?: string | string[];
};

function money(value: string | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value));
}

function date(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "America/New_York",
  }).format(new Date(value));
}

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<BookingParams>;
}) {
  const access = await requireOperationsAccess();
  const user = access.user;
  const orgScope = bookingOrgScopeParam(access);
  const params = await searchParams;
  const current = {
    view: firstParam(params.view) === "kanban" ? "kanban" : "list",
    stage: firstParam(params.stage) || "active",
    q: firstParam(params.q),
    client: firstParam(params.client),
    dateFrom: firstParam(params.dateFrom),
    dateTo: firstParam(params.dateTo),
    payment: firstParam(params.payment) || "all",
    sort: firstParam(params.sort),
    direction: firstParam(params.direction) || "asc",
  };
  const view = current.view;
  const stageFilter = current.stage;
  const sortExpressions: Record<string, string> = {
    event: "lower(event.name)",
    date: "occurrence.race_date",
    client: "lower(client.name)",
    stage: "lower(stage.name)",
    expected: "b.expected_revenue",
    actual: "b.actual_revenue",
    payment: "b.payment_at",
  };
  const sort = sortExpressions[current.sort ?? ""] ? current.sort! : "date";
  const direction = current.direction === "desc" ? "DESC" : "ASC";
  if (stageFilter === "needs_listing") {
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await autoLinkUniqueCatalogMatches(client, user);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Booking catalog auto-link failed", error);
    } finally {
      client.release();
    }
  }
  const result = await getPool().query<BookingRow>(
    `
      SELECT
        b.id::text,
        event.id::text AS event_id,
        event.name AS event_name,
        COALESCE(listing.logo_url, source_listing.logo_url) AS logo_url,
        occurrence.race_date::text,
        COALESCE(occurrence.city_override, listing.city, source_listing.city) AS city,
        COALESCE(occurrence.state_override, listing.state, source_listing.state) AS state,
        concat_ws(', ',
          NULLIF(COALESCE(occurrence.city_override, listing.city, source_listing.city), ''),
          NULLIF(COALESCE(occurrence.state_override, listing.state, source_listing.state), '')
        ) AS location,
        client.name AS direct_client,
        client.id::text AS direct_client_id,
        stage.key AS stage_key,
        stage.name AS stage_name,
        occurrence.timer_location,
        b.expected_revenue::text,
        b.actual_revenue::text,
        b.amount_paid::text,
        b.payment_at::text
      FROM crm.bookings b
      JOIN crm.event_occurrences occurrence ON occurrence.id = b.occurrence_id
      JOIN crm.events event ON event.id = occurrence.event_id
      LEFT JOIN catalog.race_listings listing
        ON listing.id = event.catalog_race_listing_id
      LEFT JOIN crm.prospects source_prospect
        ON source_prospect.converted_booking_id = b.id
      LEFT JOIN catalog.race_listings source_listing
        ON source_listing.id = source_prospect.race_listing_id
      JOIN crm.organizations client ON client.id = b.direct_client_organization_id
      JOIN crm.pipeline_stages stage ON stage.id = b.stage_id
      WHERE (
        ($1::text = 'archived' AND b.archived_at IS NOT NULL)
        OR ($1::text = 'needs_listing' AND b.archived_at IS NULL
          AND event.catalog_race_listing_id IS NULL
          AND event.catalog_match_dismissed_at IS NULL)
        OR (b.archived_at IS NULL AND $1::text <> 'needs_listing' AND (
        $1::text = 'all'
        OR ($1::text = 'active' AND stage.key NOT IN ('paid', 'closed_lost'))
        OR stage.key = $1::text
        ))
      )
        AND ($2::text IS NULL OR event.name ILIKE '%' || $2::text || '%')
        AND ($3::text IS NULL OR client.name ILIKE '%' || $3::text || '%')
        AND ($4::date IS NULL OR occurrence.race_date >= $4::date)
        AND ($5::date IS NULL OR occurrence.race_date < ($5::date + 1))
        AND (
          $6::text IS NULL OR $6::text = 'all'
          OR ($6::text = 'paid' AND b.payment_at IS NOT NULL)
          OR ($6::text = 'unpaid' AND b.payment_at IS NULL)
        )
        AND ($7::uuid[] IS NULL OR b.direct_client_organization_id = ANY($7::uuid[]))
      ORDER BY ${sortExpressions[sort]} ${direction} NULLS LAST, event.name
    `,
    [
      stageFilter,
      current.q?.trim() || null,
      current.client?.trim() || null,
      current.dateFrom || null,
      current.dateTo || null,
      current.payment,
      orgScope,
    ],
  );
  const [catalogContext, stages] = await Promise.all([
    stageFilter === "needs_listing"
      ? loadCatalogListingCandidates(
          asCatalogQuery((sql, params) => getPool().query(sql, params)),
          { names: result.rows.map((row) => row.event_name) },
        )
      : Promise.resolve(null),
    getPool().query<{ key: string; name: string }>(
      `
        SELECT key, name FROM crm.pipeline_stages
        WHERE pipeline = 'booking' AND is_active = true
        ORDER BY sort_order
      `,
    ),
  ]);
  const visibleStages =
    stageFilter === "all" || stageFilter === "archived" || stageFilter === "needs_listing"
      ? stages.rows
      : stageFilter === "active"
        ? stages.rows.filter((stage) => !["paid", "closed_lost"].includes(stage.key))
        : stages.rows.filter((stage) => stage.key === stageFilter);
  const showFinancials = access.canViewAnyFinancials;
  const rows = result.rows.map((booking) =>
    redactBookingFinancials(
      booking,
      access.canViewFinancials(booking.direct_client_id),
    ),
  );
  const filterClass = (active: boolean) =>
    `rounded-full px-3 py-1.5 text-sm ring-1 ${
      active
        ? "bg-slate-900 text-white ring-slate-900"
        : "bg-white ring-slate-200"
    }`;
  const stageOptions = [
    { key: "active", label: "Active" },
    { key: "awaiting_decision", label: "1 Awaiting decision" },
    { key: "confirmed", label: "2 Confirmed" },
    { key: "pre_event_prep", label: "3 Pre-event prep" },
    { key: "ready", label: "4 Ready" },
    { key: "completed", label: "5 Completed" },
    { key: "paid", label: "6 Paid" },
    { key: "closed_lost", label: "Closed Lost" },
    { key: "all", label: "All" },
    { key: "archived", label: "Archived" },
    { key: "needs_listing", label: "Needs listing" },
  ];
  const column = (
    label: string,
    sortKey: string,
    filters?: Parameters<typeof TableColumnHeader>[0]["filters"],
    align?: "left" | "right",
  ) => (
    <TableColumnHeader
      label={label}
      pathname="/bookings"
      params={current}
      sortKey={sortKey}
      currentSort={current.sort}
      currentDirection={current.direction === "desc" ? "desc" : "asc"}
      filters={filters}
      align={align}
    />
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-cyan-700">
            Operations
          </p>
          <h1 className="text-3xl font-bold text-slate-950">Bookings</h1>
          <p className="mt-1 text-slate-600">
            The numbered pills are the live pipeline: Awaiting decision through
            Paid. Closed Lost is an outcome. Needs listing is the catalog review
            queue.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/bookings/new"
            className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white">
            Add booking
          </Link>
          <div className="flex rounded-lg border border-slate-300 bg-white p-1">
          <Link
            href={buildSearchHref("/bookings", current, { view: "list" })}
            className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${view === "list" ? "bg-slate-900 text-white" : "text-slate-600"}`}
          >
            <List className="size-4" /> List
          </Link>
          <Link
            href={buildSearchHref("/bookings", current, { view: "kanban" })}
            className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${view === "kanban" ? "bg-slate-900 text-white" : "text-slate-600"}`}
          >
            <Columns3 className="size-4" /> Kanban
          </Link>
          </div>
        </div>
      </header>

      <nav className="flex flex-wrap gap-2" aria-label="Booking stage filters">
        {stageOptions.map(({ key, label }) => (
          <Link
            key={key}
            href={buildSearchHref("/bookings", current, { stage: key })}
            className={filterClass(stageFilter === key)}
          >
            {label}
          </Link>
        ))}
      </nav>

      {stageFilter === "needs_listing" ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">{column("Event", "event", [
                  {
                    type: "text",
                    name: "q",
                    label: "Event name",
                    placeholder: "Filter event…",
                  },
                ])}</th>
                <th className="px-4 py-3">{column("Date", "date", [
                  {
                    type: "date-range",
                    fromName: "dateFrom",
                    toName: "dateTo",
                  },
                ])}</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Suggested listings</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((booking) => {
                const suggestions = catalogContext
                  ? suggestCatalogMatches(
                      {
                        name: booking.event_name,
                        city: booking.city,
                        state: booking.state,
                      },
                      catalogContext.listings,
                      { takenIds: catalogContext.takenIds },
                    )
                  : [];
                return (
                  <tr key={booking.id} className={`${listRowClassName()} align-top`}>
                    <td className="px-4 py-3">
                      <ListRowLink className="font-semibold text-cyan-700" href={`/bookings/${booking.id}`}>
                        <EventLogo url={booking.logo_url} name={booking.event_name} size="list" />
                        <span>
                          {booking.event_name}
                          <span className="mt-0.5 block text-xs font-normal text-slate-500">{booking.direct_client}</span>
                        </span>
                      </ListRowLink>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-2">
                        <CalendarDays className="size-4 text-slate-400" />
                        {booking.race_date ? date(booking.race_date) : "TBD"}
                      </span>
                    </td>
                    <td className="px-4 py-3">{booking.location || "Not set"}</td>
                    <td className="px-4 py-3">
                      <ListRowActions>
                        <CatalogMatchControls
                          bookingId={booking.id}
                          suggestions={suggestions}
                          returnTo="/bookings?stage=needs_listing"
                          compact
                        />
                      </ListRowActions>
                    </td>
                  </tr>
                );
              })}
              {!rows.length ? (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center text-slate-500">
                    Every booking is linked or marked as not in Get Run Vibes.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          </div>
        </div>
      ) : view === "kanban" ? (
        <div className="grid gap-4 overflow-x-auto lg:grid-cols-4">
          {visibleStages.map((stage) => (
            <section key={stage.key} className="min-w-64 rounded-xl bg-slate-200/70 p-3">
              <h2 className="mb-3 flex justify-between font-semibold text-slate-800">
                {stage.name}
                <span>{rows.filter((row) => row.stage_key === stage.key).length}</span>
              </h2>
              <div className="space-y-3">
                {rows
                  .filter((row) => row.stage_key === stage.key)
                  .map((booking) => (
                    <Link
                      key={booking.id}
                      href={`/bookings/${booking.id}`}
                      className="flex items-start gap-2.5 rounded-lg bg-white p-4 shadow-sm hover:ring-2 hover:ring-cyan-500"
                    >
                      <EventLogo url={booking.logo_url} name={booking.event_name} size="list" />
                      <span>
                        <p className="font-semibold text-slate-950">{booking.event_name}</p>
                        <p className="mt-1 text-sm text-slate-600">{booking.direct_client}</p>
                        {showFinancials ? (
                          <p className="mt-3 text-sm font-medium">
                            {money(booking.actual_revenue ?? booking.expected_revenue)}
                          </p>
                        ) : null}
                      </span>
                    </Link>
                  ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">
                  {column("Event", "event", [
                    {
                      type: "text",
                      name: "q",
                      label: "Event name",
                      placeholder: "Filter event…",
                    },
                  ])}
                </th>
                <th className="px-4 py-3">
                  {column("Date", "date", [
                    {
                      type: "date-range",
                      fromName: "dateFrom",
                      toName: "dateTo",
                    },
                  ])}
                </th>
                <th className="px-4 py-3">
                  {column("Direct client", "client", [
                    {
                      type: "text",
                      name: "client",
                      label: "Client",
                      placeholder: "Filter client…",
                    },
                  ])}
                </th>
                <th className="px-4 py-3">{column("Stage", "stage")}</th>
                {showFinancials ? (
                  <>
                <th className="px-4 py-3">{column("Expected", "expected")}</th>
                <th className="px-4 py-3">{column("Actual", "actual")}</th>
                <th className="px-4 py-3">
                  {column("Payment", "payment", [
                    {
                      type: "select",
                      name: "payment",
                      label: "Payment",
                      options: [
                        { value: "all", label: "Any" },
                        { value: "paid", label: "Paid" },
                        { value: "unpaid", label: "Unpaid" },
                      ],
                    },
                  ], "right")}
                </th>
                  </>
                ) : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((booking) => (
                <tr key={booking.id} className={listRowClassName()}>
                  <td className="px-4 py-3">
                    <ListRowLink className="font-semibold text-cyan-700" href={`/bookings/${booking.id}`}>
                      <EventLogo url={booking.logo_url} name={booking.event_name} size="list" />
                      <span>
                        {booking.event_name}
                        <span className="mt-0.5 block text-xs font-normal text-slate-500">
                          {booking.timer_location?.replace("_", " ") ?? "Location TBD"}
                        </span>
                      </span>
                    </ListRowLink>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-2">
                      <CalendarDays className="size-4 text-slate-400" />
                      {booking.race_date
                        ? date(booking.race_date)
                        : "TBD"}
                    </span>
                  </td>
                  <td className="px-4 py-3">{booking.direct_client}</td>
                  <td className="px-4 py-3">{booking.stage_name}</td>
                  {showFinancials ? (
                    <>
                  <td className="px-4 py-3">{money(booking.expected_revenue)}</td>
                  <td className="px-4 py-3">{money(booking.actual_revenue)}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-2">
                      <WalletCards className="size-4 text-slate-400" />
                      {booking.payment_at ? "Paid" : "Unpaid"}
                    </span>
                  </td>
                    </>
                  ) : null}
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                    <td colSpan={showFinancials ? 7 : 4} className="px-4 py-12 text-center text-slate-500">
                    No bookings match this view and its filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}
