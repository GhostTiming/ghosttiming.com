import { ArrowLeft, ArrowRight, CalendarDays } from "lucide-react";
import Link from "next/link";
import { EventLogo } from "@/components/event-logo";
import { ListRowLink } from "@/components/list-row";
import { listRowClassName } from "@/components/list-row-class";
import { TableColumnHeader } from "@/components/table-column-header";
import { bookingOrgScopeParam } from "@/lib/auth/access";
import { requireOperationsAccess } from "@/lib/auth/server";
import { listEvents } from "@/lib/crm/event-queries";
import { buildSearchHref, firstParam, parseOptionalInteger } from "@/lib/crm/search-params";

export const metadata = { title: "Events" };

type EventParams = {
  page?: string | string[];
  scope?: string | string[];
  q?: string | string[];
  owner?: string | string[];
  yearsMin?: string | string[];
  firstYear?: string | string[];
  lastYear?: string | string[];
  nextFrom?: string | string[];
  nextTo?: string | string[];
  sort?: string | string[];
  direction?: string | string[];
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "America/New_York",
  }).format(new Date(value));
}

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<EventParams>;
}) {
  const access = await requireOperationsAccess();
  const params = await searchParams;
  const scope =
    !access.isSuperAdmin || firstParam(params.scope) !== "prospect"
      ? "client"
      : "prospect";
  const current = {
    scope,
    q: firstParam(params.q),
    owner: firstParam(params.owner),
    yearsMin: firstParam(params.yearsMin),
    firstYear: firstParam(params.firstYear),
    lastYear: firstParam(params.lastYear),
    nextFrom: firstParam(params.nextFrom),
    nextTo: firstParam(params.nextTo),
    sort: firstParam(params.sort),
    direction: firstParam(params.direction) || "asc",
  };
  const requestedPage = Number(firstParam(params.page) ?? 1);
  const result = await listEvents({
    page: Number.isFinite(requestedPage) ? requestedPage : 1,
    scope,
    search: current.q,
    owner: current.owner,
    yearsMin: parseOptionalInteger(current.yearsMin),
    firstYear: parseOptionalInteger(current.firstYear, 1900),
    lastYear: parseOptionalInteger(current.lastYear, 1900),
    nextFrom: current.nextFrom,
    nextTo: current.nextTo,
    sort: current.sort,
    direction: current.direction === "desc" ? "desc" : "asc",
    clientOrganizationIds: bookingOrgScopeParam(access),
  });
  const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));
  const column = (
    label: string,
    sortKey: string,
    filters?: Parameters<typeof TableColumnHeader>[0]["filters"],
    align?: "left" | "right",
  ) => (
    <TableColumnHeader
      label={label}
      pathname="/events"
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
            Race history
          </p>
          <h1 className="flex items-center gap-2 text-3xl font-bold text-slate-950">
            <CalendarDays aria-hidden className="size-8" />
            Events
          </h1>
          <p className="mt-1 text-slate-600">
            {current.scope === "client"
              ? "Races you have booked. Years reflect booked editions."
              : "Leads that have not been booked yet."}
            {" "}Use the funnel on a column heading to filter.
          </p>
        </div>
      </header>

      {access.isSuperAdmin ? (
      <nav className="flex flex-wrap gap-2" aria-label="Event list scope">
        <Link
          href={buildSearchHref("/events", current, { scope: "client", page: null })}
          className={`rounded-full px-3 py-1.5 text-sm ring-1 ${
            current.scope === "client"
              ? "bg-slate-900 text-white ring-slate-900"
              : "bg-white ring-slate-200"
          }`}
        >
          Client events
        </Link>
        <Link
          href={buildSearchHref("/events", current, { scope: "prospect", page: null })}
          className={`rounded-full px-3 py-1.5 text-sm ring-1 ${
            current.scope === "prospect"
              ? "bg-slate-900 text-white ring-slate-900"
              : "bg-white ring-slate-200"
          }`}
        >
          Prospect events
        </Link>
      </nav>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-4 py-3">
                {column("Event", "name", [
                  {
                    type: "text",
                    name: "q",
                    label: "Event name",
                    placeholder: "Circle K 5K…",
                  },
                ])}
              </th>
              <th className="px-4 py-3">
                {column("Owner", "owner", [
                  {
                    type: "text",
                    name: "owner",
                    label: "Owner",
                    placeholder: "Filter owner…",
                  },
                ])}
              </th>
              <th className="px-4 py-3">
                {column("Years", "years", [
                  {
                    type: "number",
                    name: "yearsMin",
                    label: "At least this many years",
                    placeholder: "1",
                    min: 0,
                  },
                ])}
              </th>
              <th className="px-4 py-3">
                {column("First", "first_year", [
                  {
                    type: "number",
                    name: "firstYear",
                    label: "First year",
                    placeholder: "2020",
                    min: 1900,
                  },
                ])}
              </th>
              <th className="px-4 py-3">
                {column("Latest", "last_year", [
                  {
                    type: "number",
                    name: "lastYear",
                    label: "Latest year",
                    placeholder: "2026",
                    min: 1900,
                  },
                ])}
              </th>
              <th className="px-4 py-3">
                {column("Next date", "next_date", [
                  {
                    type: "date-range",
                    fromName: "nextFrom",
                    toName: "nextTo",
                  },
                ], "right")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {result.rows.map((event) => (
              <tr key={event.id} className={listRowClassName()}>
                <td className="px-4 py-3">
                  <ListRowLink href={`/events/${event.id}`} className="font-semibold hover:text-cyan-700">
                    <EventLogo url={event.logo_url} name={event.name} size="list" />
                    {event.name}
                  </ListRowLink>
                </td>
                <td className="px-4 py-3 text-slate-600">{event.owner_name ?? "—"}</td>
                <td className="px-4 py-3">{event.occurrence_count}</td>
                <td className="px-4 py-3">{event.first_year ?? "—"}</td>
                <td className="px-4 py-3">{event.last_year ?? "—"}</td>
                <td className="px-4 py-3">{formatDate(event.next_date)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {result.rows.length === 0 ? (
          <p className="p-10 text-center text-slate-500">No events match this search.</p>
        ) : null}
        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm">
          <p className="text-slate-500">
            Page {result.page} of {lastPage} · {result.total.toLocaleString()} events
          </p>
          <div className="flex gap-2">
            <Link
              href={buildSearchHref("/events", current, {
                page: String(Math.max(1, result.page - 1)),
              })}
              aria-disabled={result.page <= 1}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 font-medium aria-disabled:pointer-events-none aria-disabled:opacity-40"
            >
              <ArrowLeft aria-hidden className="size-4" />
              Previous
            </Link>
            <Link
              href={buildSearchHref("/events", current, {
                page: String(Math.min(lastPage, result.page + 1)),
              })}
              aria-disabled={result.page >= lastPage}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 font-medium aria-disabled:pointer-events-none aria-disabled:opacity-40"
            >
              Next
              <ArrowRight aria-hidden className="size-4" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
