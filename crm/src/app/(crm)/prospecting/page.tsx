import { ArrowLeft, ArrowRight, Plus } from "lucide-react";
import Link from "next/link";
import { startProspectAction } from "@/app/actions";
import { DatasetFilterNav } from "@/components/dataset-filter-nav";
import {
  DatasetBulkRoot,
  DatasetCheckbox,
  DatasetHeaderCheckbox,
} from "@/components/dataset-bulk";
import { ProspectBulkBar } from "@/components/prospect-bulk-bar";
import { EventLogo } from "@/components/event-logo";
import { ListRowActions, ListRowLink } from "@/components/list-row";
import { listRowClassName } from "@/components/list-row-class";
import { ContactExtractionButton } from "@/components/prospecting/contact-extraction-button";
import { ProspectListStageBubbles } from "@/components/prospecting/list-stage-bubbles";
import { ProspectingLocationFilter } from "@/components/prospecting-location-filter";
import { TableColumnHeader } from "@/components/table-column-header";
import { getPool } from "@/db";
import { requireProspectingUser } from "@/lib/auth/server";
import { formatNextStep } from "@/lib/crm/domain";
import { reconcileProspectingWithPool, listProspects } from "@/lib/crm/queries";
import { MOBILE_CARDS, TABLE_SCROLL } from "@/lib/crm/layout";
import { buildSearchHref, firstParam, parseOptionalInteger } from "@/lib/crm/search-params";

export const metadata = { title: "Prospecting" };
export const maxDuration = 30;

type ProspectingParams = {
  page?: string | string[];
  view?: string | string[];
  phone?: string | string[];
  email?: string | string[];
  touches?: string | string[];
  q?: string | string[];
  eventFrom?: string | string[];
  eventTo?: string | string[];
  state?: string | string[];
  city?: string | string[];
  zip?: string | string[];
  miles?: string | string[];
  sort?: string | string[];
  direction?: string | string[];
};

const presenceOptions = [
  { value: "all", label: "Any" },
  { value: "has", label: "Has value" },
  { value: "missing", label: "Missing" },
];

function formatDate(value: string | null) {
  if (!value) return "Unknown";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value.slice(0, 10)
    : new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "America/New_York",
      }).format(date);
}

export default async function ProspectingPage({
  searchParams,
}: {
  searchParams: Promise<ProspectingParams>;
}) {
  const user = await requireProspectingUser();
  await reconcileProspectingWithPool(user);
  const params = await searchParams;
  const current = {
    view: firstParam(params.view) || "active",
    phone: firstParam(params.phone) || "all",
    email: firstParam(params.email) || "all",
    touches: firstParam(params.touches),
    q: firstParam(params.q),
    eventFrom: firstParam(params.eventFrom),
    eventTo: firstParam(params.eventTo),
    state: firstParam(params.state),
    city: firstParam(params.city),
    zip: firstParam(params.zip),
    miles: firstParam(params.miles),
    sort: firstParam(params.sort),
    direction: firstParam(params.direction) || "asc",
  };
  const requestedPage = Number(firstParam(params.page) ?? 1);
  const result = await listProspects({
    page: Number.isFinite(requestedPage) ? requestedPage : 1,
    view: current.view,
    phone: current.phone === "has" || current.phone === "missing"
      ? current.phone
      : "all",
    email: current.email === "has" || current.email === "missing"
      ? current.email
      : "all",
    touches: parseOptionalInteger(current.touches),
    search: current.q,
    eventFrom: current.eventFrom,
    eventTo: current.eventTo,
    state: current.state,
    city: current.city,
    zip: current.zip,
    miles: parseOptionalInteger(current.miles, 1),
    sort: current.sort,
    direction: current.direction === "desc" ? "desc" : "asc",
  });
  const users = await getPool().query<{ id: string; name: string }>(
    `SELECT id::text, name FROM crm.users WHERE is_active ORDER BY name`,
  );
  const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));
  const viewOptions = [
    { key: "active", label: "Active" },
    { key: "candidate", label: "1 Candidates" },
    { key: "cold", label: "2 Contacting" },
    { key: "scoping", label: "3 Scoping" },
    { key: "confirmed", label: "4 Confirmed" },
    { key: "closed_lost", label: "Closed Lost" },
    { key: "disqualified", label: "Disqualified" },
    { key: "unqualified", label: "Unqualified" },
    { key: "past_event", label: "Past events" },
    { key: "all", label: "All" },
    { key: "archived", label: "Archived" },
  ];
  const column = (
    label: string,
    sortKey: string,
    filters?: Parameters<typeof TableColumnHeader>[0]["filters"],
    align?: "left" | "right",
  ) => (
    <TableColumnHeader
      label={label}
      pathname="/prospecting"
      params={current}
      sortKey={sortKey}
      currentSort={current.sort}
      currentDirection={current.direction === "desc" ? "desc" : "asc"}
      filters={filters}
      align={align}
    />
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-cyan-700">
            Race-first pipeline
          </p>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Prospecting</h1>
          <p className="mt-1 text-sm text-slate-600">
            The numbered pills are the live pipeline: Candidates, Contacting,
            Scoping, then Confirmed. Candidates only include Get Run Vibes
            listings flagged with a phone or email. Closed Lost, Disqualified,
            Unqualified, and Past events are outcomes. Races whose date has
            already passed move to Past events automatically. Use Filter for
            city, state, or ZIP radius.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/prospecting/new"
            className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white">
            <Plus className="mr-1 inline size-4" /> Add lead
          </Link>
          <ContactExtractionButton />
        </div>
      </div>

      <DatasetFilterNav
        ariaLabel="Prospect stage"
        value={current.view}
        options={viewOptions.map(({ key, label }) => ({
          value: key,
          label,
          href: buildSearchHref("/prospecting", current, {
            view: key,
            page: null,
          }),
        }))}
        trailing={<ProspectingLocationFilter params={current} />}
      />

      <DatasetBulkRoot>
      <div className="space-y-3">
      <ProspectBulkBar users={users.rows} />
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className={MOBILE_CARDS + " p-3"}>
          <label className="flex items-center gap-2 px-1 text-sm text-slate-600">
            <DatasetHeaderCheckbox
              ids={result.rows
                .map((row) => row.prospect_id)
                .filter((id): id is string => Boolean(id))}
            />
            Select all
          </label>
          {result.rows.map((row) => {
            const href = row.prospect_id
              ? `/prospecting/${row.prospect_id}`
              : null;
            return (
              <article
                key={row.prospect_id ?? row.race_listing_id}
                className="relative rounded-xl border border-slate-200 bg-slate-50 p-3"
              >
                <div className="flex items-start gap-3">
                  {row.prospect_id ? <DatasetCheckbox id={row.prospect_id} /> : null}
                  <div className="min-w-0 flex-1 space-y-2">
                    {href ? (
                      <ListRowLink
                        href={href}
                        className="font-semibold text-slate-900"
                      >
                        <EventLogo
                          url={row.logo_url}
                          name={row.race_name}
                          size="list"
                        />
                        <span>
                          <span className="block">{row.race_name}</span>
                          <span className="block text-xs font-normal text-slate-500">
                            {row.location || "—"}
                          </span>
                        </span>
                      </ListRowLink>
                    ) : (
                      <div className="flex items-start gap-2.5">
                        <EventLogo
                          url={row.logo_url}
                          name={row.race_name}
                          size="list"
                        />
                        <div>
                          <p className="font-semibold text-slate-900">{row.race_name}</p>
                          <p className="text-xs text-slate-500">{row.location || "—"}</p>
                        </div>
                      </div>
                    )}
                    <p className="text-sm text-slate-600">
                      {formatDate(row.event_date)} · {row.stage_name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {row.owner_name ?? "Unassigned"}
                      {row.primary_phone ? ` · ${row.primary_phone}` : ""}
                      {row.primary_email ? ` · ${row.primary_email}` : ""}
                    </p>
                    <ListRowActions>
                      {row.prospect_id ? (
                        <ProspectListStageBubbles
                          prospectId={row.prospect_id}
                          currentStageKey={row.stage_key}
                        />
                      ) : (
                        <form action={startProspectAction}>
                          <input
                            type="hidden"
                            name="raceListingId"
                            value={row.race_listing_id ?? undefined}
                          />
                          <button
                            type="submit"
                            className="inline-flex items-center gap-1 font-semibold text-cyan-700"
                          >
                            <Plus aria-hidden className="size-4" />
                            Start
                          </button>
                        </form>
                      )}
                    </ListRowActions>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
        <div className={`hidden md:block ${TABLE_SCROLL}`}>
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-10 px-4 py-3">
                  <DatasetHeaderCheckbox
                    ids={result.rows
                      .map((row) => row.prospect_id)
                      .filter((id): id is string => Boolean(id))}
                  />
                </th>
                <th className="px-4 py-3">
                  {column("Race", "race", [
                    {
                      type: "text",
                      name: "q",
                      label: "Race name",
                      placeholder: "Filter race…",
                    },
                  ])}
                </th>
                <th className="px-4 py-3">
                  {column("Event date", "event_date", [
                    {
                      type: "date-range",
                      fromName: "eventFrom",
                      toName: "eventTo",
                    },
                  ])}
                </th>
                <th className="px-4 py-3">{column("Stage", "stage")}</th>
                <th className="px-4 py-3">
                  {column("Phone", "phone", [
                    {
                      type: "select",
                      name: "phone",
                      label: "Phone",
                      options: presenceOptions,
                    },
                  ])}
                </th>
                <th className="px-4 py-3">
                  {column("Email", "email", [
                    {
                      type: "select",
                      name: "email",
                      label: "Email",
                      options: presenceOptions,
                    },
                  ])}
                </th>
                <th className="px-4 py-3">
                  {column("Touches", "touches", [
                    {
                      type: "number",
                      name: "touches",
                      label: "Exact touches",
                      placeholder: "0",
                      min: 0,
                    },
                  ])}
                </th>
                <th className="px-4 py-3">{column("Last touch", "last_touch")}</th>
                <th className="px-4 py-3">{column("Next step", "next_step")}</th>
                <th className="px-4 py-3">{column("Owner", "owner", undefined, "right")}</th>
                <th className="px-4 py-3" aria-label="Actions" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {result.rows.map((row) => {
                const href = row.prospect_id
                  ? `/prospecting/${row.prospect_id}`
                  : null;
                return (
                <tr
                  key={row.prospect_id ?? row.race_listing_id}
                  className={href ? listRowClassName() : "hover:bg-slate-50"}
                >
                  <td className="px-4 py-3">
                    {row.prospect_id ? (
                      <DatasetCheckbox id={row.prospect_id} />
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    {href ? (
                      <ListRowLink
                        href={href}
                        className="font-semibold text-slate-900 hover:text-cyan-800"
                      >
                        <EventLogo
                          url={row.logo_url}
                          name={row.race_name}
                          size="list"
                        />
                        <span>
                          <span className="block max-w-xs">{row.race_name}</span>
                          <span className="block text-xs font-normal text-slate-500">
                            {row.location || "—"}
                          </span>
                        </span>
                      </ListRowLink>
                    ) : (
                      <div className="flex items-start gap-2.5">
                        <EventLogo
                          url={row.logo_url}
                          name={row.race_name}
                          size="list"
                        />
                        <div>
                          <p className="max-w-xs font-semibold text-slate-900">
                            {row.race_name}
                          </p>
                          <p className="text-xs text-slate-500">{row.location || "—"}</p>
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {formatDate(row.event_date)}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium">
                      {row.stage_name}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {row.primary_phone ?? (row.contact_processed ? "—" : "Detected")}
                  </td>
                  <td className="px-4 py-3">
                    {row.primary_email ?? (row.contact_processed ? "—" : "Detected")}
                  </td>
                  <td className="px-4 py-3">{row.touch_count}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {formatDate(row.last_touch_at)}
                  </td>
                  <td className="px-4 py-3">
                    <p>{formatNextStep(row.next_step) ?? "—"}</p>
                    {row.next_step_at ? (
                      <p className="text-xs text-slate-500">
                        {formatDate(row.next_step_at)}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">{row.owner_name ?? "Unassigned"}</td>
                  <td className="px-4 py-3 text-right">
                    <ListRowActions>
                      {row.prospect_id ? (
                        <ProspectListStageBubbles
                          prospectId={row.prospect_id}
                          currentStageKey={row.stage_key}
                        />
                      ) : (
                        <form action={startProspectAction}>
                          <input
                            type="hidden"
                            name="raceListingId"
                            value={row.race_listing_id ?? undefined}
                          />
                          <button
                            type="submit"
                            className="inline-flex items-center gap-1 font-semibold text-cyan-700 hover:text-cyan-900"
                          >
                            <Plus aria-hidden className="size-4" />
                            Start
                          </button>
                        </form>
                      )}
                    </ListRowActions>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {result.rows.length === 0 ? (
          <p className="p-10 text-center text-slate-500">
            No prospects match this view and its filters.
          </p>
        ) : null}
        <div className="flex flex-col gap-3 border-t border-slate-200 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="text-slate-500">
            Page {result.page} of {lastPage} · {result.total.toLocaleString()} records
          </p>
          <div className="flex gap-2">
            <Link
              href={buildSearchHref("/prospecting", current, {
                page: String(Math.max(1, result.page - 1)),
              })}
              aria-disabled={result.page <= 1}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 font-medium aria-disabled:pointer-events-none aria-disabled:opacity-40"
            >
              <ArrowLeft aria-hidden className="size-4" />
              Previous
            </Link>
            <Link
              href={buildSearchHref("/prospecting", current, {
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
      </DatasetBulkRoot>
    </div>
  );
}
