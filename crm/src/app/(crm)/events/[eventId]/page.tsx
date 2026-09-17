import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalHref } from "@/components/crm-links";
import { EventLogo } from "@/components/event-logo";
import { ListRowLink } from "@/components/list-row";
import { listRowClassName } from "@/components/list-row-class";
import { TableColumnHeader } from "@/components/table-column-header";
import { requireOperationsAccess } from "@/lib/auth/server";
import { getEventDetail, type EventOccurrenceRow } from "@/lib/crm/event-queries";
import { MOBILE_CARDS } from "@/lib/crm/layout";
import { parseRouteUuid } from "@/lib/crm/route-id";
import { firstParam } from "@/lib/crm/search-params";

export const metadata = { title: "Event" };

type EventDetailParams = {
  sort?: string | string[];
  direction?: string | string[];
  year?: string | string[];
  dateFrom?: string | string[];
  dateTo?: string | string[];
  location?: string | string[];
  client?: string | string[];
  status?: string | string[];
};

function formatDate(value: string | null) {
  if (!value) return "Date TBD";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "America/New_York",
  }).format(new Date(value));
}

function statusOf(row: EventOccurrenceRow) {
  return row.booking_stage ?? row.prospect_stage ?? "No pipeline";
}

function recordHref(row: EventOccurrenceRow, canAccessProspecting: boolean) {
  if (row.booking_id) return `/bookings/${row.booking_id}`;
  if (canAccessProspecting && row.prospect_id) return `/prospecting/${row.prospect_id}`;
  return null;
}

function sortValue(row: EventOccurrenceRow, sort: string) {
  switch (sort) {
    case "date":
      return row.race_date ?? "";
    case "stage":
      return statusOf(row).toLowerCase();
    case "client":
      return (row.client_name ?? "").toLowerCase();
    case "location":
      return row.location.toLowerCase();
    default:
      return String(row.occurrence_year ?? 0).padStart(4, "0");
  }
}

function dateKey(value: string | null) {
  return value?.slice(0, 10) ?? "";
}

export default async function EventDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<EventDetailParams>;
}) {
  const access = await requireOperationsAccess();
  const eventId = parseRouteUuid((await params).eventId);
  const query = await searchParams;
  const current = {
    sort: firstParam(query.sort),
    direction: firstParam(query.direction) || "desc",
    year: firstParam(query.year),
    dateFrom: firstParam(query.dateFrom),
    dateTo: firstParam(query.dateTo),
    location: firstParam(query.location),
    client: firstParam(query.client),
    status: firstParam(query.status),
  };
  const data = await getEventDetail(eventId);
  if (!data.event) notFound();
  if (
    !access.isSuperAdmin &&
    !data.occurrences.some(
      (row) => row.client_id && access.canAccessOrganization(row.client_id),
    ) &&
    !(data.event.owner_id && access.canAccessOrganization(data.event.owner_id))
  ) {
    notFound();
  }
  const pathname = `/events/${eventId}`;
  const activeSort = ["year", "date", "stage", "client", "location"].includes(
    current.sort ?? "",
  )
    ? current.sort!
    : "year";
  const descending = current.direction !== "asc";
  const yearFilter = Number(current.year);
  const occurrences = [...data.occurrences]
    .filter((row) => {
      if (
        current.year &&
        (!Number.isInteger(yearFilter) || row.occurrence_year !== yearFilter)
      ) {
        return false;
      }
      const raceDate = dateKey(row.race_date);
      if (current.dateFrom && raceDate < current.dateFrom) return false;
      if (current.dateTo && (!raceDate || raceDate > current.dateTo)) return false;
      if (
        current.location &&
        !row.location.toLowerCase().includes(current.location.toLowerCase())
      ) {
        return false;
      }
      if (
        current.client &&
        !(row.client_name ?? "")
          .toLowerCase()
          .includes(current.client.toLowerCase())
      ) {
        return false;
      }
      if (
        current.status &&
        !statusOf(row).toLowerCase().includes(current.status.toLowerCase())
      ) {
        return false;
      }
      return true;
    })
    .sort((left, right) => {
      const comparison = sortValue(left, activeSort).localeCompare(
        sortValue(right, activeSort),
        undefined,
        { numeric: true },
      );
      return descending ? -comparison : comparison;
    });
  const column = (
    label: string,
    sortKey: string,
    filters?: Parameters<typeof TableColumnHeader>[0]["filters"],
    align?: "left" | "right",
  ) => (
    <TableColumnHeader
      label={label}
      pathname={pathname}
      params={current}
      sortKey={sortKey}
      currentSort={activeSort}
      currentDirection={descending ? "desc" : "asc"}
      filters={filters}
      align={align}
    />
  );

  return (
    <div className="space-y-6">
      <Link href="/events" className="inline-flex items-center gap-2 text-sm font-medium text-slate-600">
        <ArrowLeft className="size-4" /> Back to events
      </Link>
      <header className="rounded-2xl bg-slate-950 p-6 text-white">
        <p className="text-sm font-semibold uppercase tracking-wider text-cyan-300">
          Standing event
        </p>
        <h1 className="mt-1 flex items-center gap-3 text-3xl font-bold">
          <EventLogo
            url={data.event.logo_url}
            name={data.event.name}
            size="header"
            tone="dark"
          />
          {data.event.name}
        </h1>
        <p className="mt-2 text-slate-300">
          {data.event.owner_name ?? "No owner set"} · {data.occurrences.length}{" "}
          {data.occurrences.length === 1 ? "year" : "years"}
        </p>
        {data.event.website ? (
          <ExternalHref href={data.event.website} className="mt-3 inline-block text-sm text-cyan-300 underline">
            {data.event.website}
          </ExternalHref>
        ) : null}
      </header>

      {data.event.notes ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="font-bold">Notes</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{data.event.notes}</p>
        </section>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="font-bold">Year history</h2>
          <p className="text-sm text-slate-500">
            Bookings, lost years, and open leads for this race.
            Use the funnel on a column heading to filter.
          </p>
        </div>
        <div className={`${MOBILE_CARDS} p-3`}>
          {occurrences.map((row) => {
            const href = recordHref(row, access.canAccessProspecting);
            return (
              <article
                key={row.id}
                className="relative rounded-xl border border-slate-200 bg-slate-50 p-3"
              >
                {href ? (
                  <ListRowLink href={href} className="font-semibold">
                    {row.occurrence_year ?? "—"}
                  </ListRowLink>
                ) : (
                  <p className="font-semibold">{row.occurrence_year ?? "—"}</p>
                )}
                <p className="mt-1 text-sm text-slate-600">{formatDate(row.race_date)}</p>
                <p className="text-sm text-slate-500">{row.location || "—"}</p>
                <p className="text-sm text-slate-500">{row.client_name ?? "—"}</p>
                <p className="mt-1 text-sm font-medium">{statusOf(row)}</p>
              </article>
            );
          })}
          {occurrences.length === 0 ? (
            <p className="p-6 text-center text-slate-500">No years match these filters.</p>
          ) : null}
        </div>
        <div className="hidden md:block">
        <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-4 py-3">
                {column("Year", "year", [
                  {
                    type: "number",
                    name: "year",
                    label: "Year",
                    placeholder: "2026",
                    min: 1900,
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
                {column("Location", "location", [
                  {
                    type: "text",
                    name: "location",
                    label: "Location",
                    placeholder: "City or state…",
                  },
                ])}
              </th>
              <th className="px-4 py-3">
                {column("Client / owner", "client", [
                  {
                    type: "text",
                    name: "client",
                    label: "Client or owner",
                    placeholder: "Filter client…",
                  },
                ])}
              </th>
              <th className="px-4 py-3">
                {column("Status", "stage", [
                  {
                    type: "text",
                    name: "status",
                    label: "Status",
                    placeholder: "Booking, lead…",
                  },
                ], "right")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {occurrences.map((row) => {
              const href = recordHref(row, access.canAccessProspecting);
              return (
                <tr
                  key={row.id}
                  className={href ? listRowClassName() : "hover:bg-slate-50"}
                >
                  <td className="px-4 py-3 font-semibold">
                    {href ? (
                      <ListRowLink href={href} className="font-semibold">
                        {row.occurrence_year ?? "—"}
                      </ListRowLink>
                    ) : (
                      (row.occurrence_year ?? "—")
                    )}
                  </td>
                  <td className="px-4 py-3">{formatDate(row.race_date)}</td>
                  <td className="px-4 py-3">{row.location || "—"}</td>
                  <td className="px-4 py-3">{row.client_name ?? "—"}</td>
                  <td className="px-4 py-3">{statusOf(row)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        </div>
        {occurrences.length === 0 ? (
          <p className="hidden p-10 text-center text-slate-500 md:block">No years match these filters.</p>
        ) : null}
      </section>
    </div>
  );
}
