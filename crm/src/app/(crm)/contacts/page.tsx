import { Plus } from "lucide-react";
import Link from "next/link";
import { bulkUpdateContactsAction } from "@/app/bulk-actions";
import { DatasetBulkBar, DatasetBulkRoot, DatasetCheckbox, DatasetHeaderCheckbox } from "@/components/dataset-bulk";
import { FilterChipNav } from "@/components/filter-chip-nav";
import { MailtoLink } from "@/components/crm-links";
import { ListRowLink } from "@/components/list-row";
import { listRowClassName } from "@/components/list-row-class";
import { TableColumnHeader } from "@/components/table-column-header";
import { requireContactsAccess } from "@/lib/auth/server";
import { contactBulkFields } from "@/lib/crm/bulk-fields";
import {
  listCrewContacts,
  listDirectClientContacts,
  listEventClientContacts,
  listProspectContacts,
  loadContactOrgScope,
} from "@/lib/crm/contact-queries";
import {
  formatContactEventNames,
  parseContactListStatus,
  parseContactListView,
  contactBulkPersonId,
  type ContactListView,
} from "@/lib/crm/contacts";
import { DESKTOP_TABLE, MOBILE_CARDS } from "@/lib/crm/layout";
import { buildSearchHref, firstParam } from "@/lib/crm/search-params";

export const metadata = { title: "Contacts" };

const presenceOptions = [
  { value: "all", label: "Any" },
  { value: "has", label: "Has value" },
  { value: "missing", label: "Missing" },
];

type ContactParams = {
  view?: string | string[];
  archived?: string | string[];
  inactive?: string | string[];
  q?: string | string[];
  email?: string | string[];
  phone?: string | string[];
  organization?: string | string[];
  event?: string | string[];
  race?: string | string[];
  sort?: string | string[];
  direction?: string | string[];
};

const viewCopy: Record<ContactListView, string> = {
  direct_clients:
    "Main contacts at Ghost Timing’s direct client companies.",
  event_clients:
    "Race directors and primaries on events we’ve booked.",
  crew: "Crew assigned to live bookings, or people tagged as crew.",
  prospects:
    "Historical emails and phones from race listings and prospecting.",
};

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<ContactParams>;
}) {
  const access = await requireContactsAccess();
  const params = await searchParams;
  const view = parseContactListView(firstParam(params.view), access);
  const current = {
    view,
    archived: firstParam(params.archived),
    inactive: firstParam(params.inactive),
    q: firstParam(params.q),
    email: firstParam(params.email) || "all",
    phone: firstParam(params.phone) || "all",
    organization: firstParam(params.organization),
    event: firstParam(params.event),
    race: firstParam(params.race),
    sort: firstParam(params.sort),
    direction: firstParam(params.direction) || "asc",
  };
  const status = parseContactListStatus(current.archived, current.inactive);
  const direction = current.direction === "desc" ? "DESC" : "ASC";
  const organizationSort: Record<string, string> = {
    name: "lower(COALESCE(person.display_name, ''))",
    email: "lower(person.email)",
    phone: "person.phone",
    organizations:
      "lower(COALESCE(array_to_string(array_agg(DISTINCT org.name), ', '), ''))",
  };
  const eventSort: Record<string, string> = {
    ...organizationSort,
    events:
      "lower(COALESCE(array_to_string(array_agg(DISTINCT listed_event.name), ', '), ''))",
  };
  const prospectSort: Record<string, string> = {
    name: "lower(display_name)",
    email: "lower(email)",
    phone: "phone",
    race: "lower(COALESCE(race_name, ''))",
  };
  const sortExpressions =
    view === "prospects"
      ? prospectSort
      : view === "event_clients" || view === "crew"
        ? eventSort
        : organizationSort;
  const sort = sortExpressions[current.sort ?? ""] ? current.sort! : "name";
  const listQuery = {
    status,
    q: current.q?.trim() || null,
    email: current.email,
    phone: current.phone,
    organization: current.organization,
    event: current.event,
    race: current.race,
    sortSql: sortExpressions[sort],
    direction: direction as "ASC" | "DESC",
  };
  const scope =
    view === "prospects" ? null : await loadContactOrgScope(access);
  const directClientContacts =
    view === "direct_clients" && scope
      ? await listDirectClientContacts(scope, listQuery)
      : null;
  const eventClientContacts =
    view === "event_clients" && scope
      ? await listEventClientContacts(scope, listQuery)
      : null;
  const crewContacts =
    view === "crew" && scope ? await listCrewContacts(scope, listQuery) : null;
  const prospectContacts =
    view === "prospects" ? await listProspectContacts(listQuery) : null;
  const column = (
    label: string,
    sortKey: string,
    filters?: Parameters<typeof TableColumnHeader>[0]["filters"],
  ) => (
    <TableColumnHeader
      label={label}
      pathname="/contacts"
      params={current}
      sortKey={sortKey}
      currentSort={current.sort}
      currentDirection={current.direction === "desc" ? "desc" : "asc"}
      filters={filters}
    />
  );
  const viewHref = (nextView: ContactListView) =>
    buildSearchHref("/contacts", current, {
      view: nextView,
      organization: null,
      event: null,
      race: null,
      sort: null,
      direction: null,
    });
  const viewTabs: Array<{ key: ContactListView; label: string; show: boolean }> = [
    {
      key: "direct_clients",
      label: "Direct clients",
      show: access.canAccessOperations,
    },
    {
      key: "event_clients",
      label: "Event clients",
      show: access.canAccessOperations,
    },
    { key: "crew", label: "Crew", show: access.canAccessOperations },
    { key: "prospects", label: "Prospects", show: access.canAccessProspecting },
  ];
  const showEvents = view === "event_clients" || view === "crew";
  const columnCount = (view === "prospects" ? 4 : showEvents ? 5 : 4) +
    (access.canAccessOperations ? 1 : 0);
  const rowCount =
    view === "direct_clients"
      ? directClientContacts?.rows.length ?? 0
      : view === "event_clients"
        ? eventClientContacts?.rows.length ?? 0
        : view === "crew"
          ? crewContacts?.rows.length ?? 0
          : prospectContacts?.rows.length ?? 0;
  const selectableIds = (
    directClientContacts?.rows ??
    eventClientContacts?.rows ??
    crewContacts?.rows ??
    prospectContacts?.rows ??
    []
  )
    .map((row) => contactBulkPersonId(row.id))
    .filter((id): id is string => Boolean(id));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-cyan-700">
            Relationships
          </p>
          <h1 className="text-2xl font-bold text-slate-950 sm:text-3xl">Contacts</h1>
          <p className="mt-1 text-slate-600">{viewCopy[view]}</p>
        </div>
        {view !== "prospects" && access.canAccessOperations ? (
          <Link
            href="/contacts/new"
            className="w-full rounded-lg bg-cyan-700 px-4 py-2 text-center text-sm font-semibold text-white sm:w-auto"
          >
            <Plus className="mr-1 inline size-4" /> Add contact
          </Link>
        ) : null}
      </header>

      <FilterChipNav
        ariaLabel="Contact list views"
        value={view}
        options={viewTabs
          .filter((tab) => tab.show)
          .map((tab) => ({
            value: tab.key,
            label: tab.label,
            href: viewHref(tab.key),
          }))}
      />

      <DatasetBulkRoot>
      <div className="space-y-3">
      {access.canAccessOperations ? (
        <DatasetBulkBar
          noun="contacts"
          fields={contactBulkFields}
          updateAction={bulkUpdateContactsAction}
        />
      ) : null}
      <FilterChipNav
        ariaLabel="Contact status"
        value={status}
        options={[
          {
            value: "active",
            label: "Active",
            href: buildSearchHref("/contacts", current, {
              archived: null,
              inactive: null,
            }),
          },
          {
            value: "inactive",
            label: "Inactive",
            href: buildSearchHref("/contacts", current, {
              archived: null,
              inactive: "1",
            }),
          },
          {
            value: "archived",
            label: "Archived",
            href: buildSearchHref("/contacts", current, {
              archived: "1",
              inactive: null,
            }),
          },
        ]}
      />

      <div className={MOBILE_CARDS}>
        {access.canAccessOperations ? (
          <label className="flex items-center gap-2 px-1 text-sm text-slate-600">
            <DatasetHeaderCheckbox ids={selectableIds} />
            Select all
          </label>
        ) : null}
        {directClientContacts?.rows.map((contact) => (
          <PersonCard
            key={contact.id}
            href={`/contacts/${contact.id}`}
            name={contact.display_name}
            email={contact.email}
            phone={contact.phone}
            organizationNames={contact.organization_names}
            checkboxId={access.canAccessOperations ? contact.id : null}
          />
        ))}
        {eventClientContacts?.rows.map((contact) => (
          <PersonCard
            key={contact.id}
            href={`/contacts/${contact.id}`}
            name={contact.display_name}
            email={contact.email}
            phone={contact.phone}
            organizationNames={contact.organization_names}
            eventNames={contact.event_names}
            checkboxId={access.canAccessOperations ? contact.id : null}
          />
        ))}
        {crewContacts?.rows.map((contact) => (
          <PersonCard
            key={contact.id}
            href={`/contacts/${contact.id}`}
            name={contact.display_name}
            email={contact.email}
            phone={contact.phone}
            organizationNames={contact.organization_names}
            eventNames={contact.event_names}
            checkboxId={access.canAccessOperations ? contact.id : null}
          />
        ))}
        {prospectContacts?.rows.map((contact) => (
          <PersonCard
            key={contact.id}
            href={contact.href}
            name={contact.display_name}
            email={contact.email}
            phone={contact.phone}
            raceName={contact.race_name}
            checkboxId={
              access.canAccessOperations ? contactBulkPersonId(contact.id) : null
            }
          />
        ))}
        {!rowCount ? (
          <p className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">
            No contacts match this view and its filters.
          </p>
        ) : null}
      </div>

      <section className={DESKTOP_TABLE}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                {access.canAccessOperations ? (
                <th className="w-10 px-4 py-3">
                  <DatasetHeaderCheckbox ids={selectableIds} />
                </th>
                ) : null}
                <th className="px-4 py-3">
                  {column("Name", "name", [
                    {
                      type: "text",
                      name: "q",
                      label: "Name",
                      placeholder: "Filter name…",
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
                  {column("Phone", "phone", [
                    {
                      type: "select",
                      name: "phone",
                      label: "Phone",
                      options: presenceOptions,
                    },
                  ])}
                </th>
                {view === "prospects" ? (
                  <th className="px-4 py-3">
                    {column("Race", "race", [
                      {
                        type: "text",
                        name: "race",
                        label: "Race",
                        placeholder: "Filter race…",
                      },
                    ])}
                  </th>
                ) : (
                  <th className="px-4 py-3">
                    {column("Organizations", "organizations", [
                      {
                        type: "text",
                        name: "organization",
                        label: "Organization",
                        placeholder: "Filter organizations…",
                      },
                    ])}
                  </th>
                )}
                {showEvents ? (
                  <th className="px-4 py-3">
                    {column("Events", "events", [
                      {
                        type: "text",
                        name: "event",
                        label: "Event",
                        placeholder: "Filter events…",
                      },
                    ])}
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {directClientContacts?.rows.map((contact) => (
                <tr key={contact.id} className={listRowClassName()}>
                  {access.canAccessOperations ? (
                  <td className="px-4 py-3">
                    <DatasetCheckbox id={contact.id} />
                  </td>
                  ) : null}
                  <PersonCells
                    href={`/contacts/${contact.id}`}
                    name={contact.display_name}
                    email={contact.email}
                    phone={contact.phone}
                    organizationNames={contact.organization_names}
                  />
                </tr>
              ))}
              {eventClientContacts?.rows.map((contact) => (
                <tr key={contact.id} className={listRowClassName()}>
                  {access.canAccessOperations ? (
                  <td className="px-4 py-3">
                    <DatasetCheckbox id={contact.id} />
                  </td>
                  ) : null}
                  <PersonCells
                    href={`/contacts/${contact.id}`}
                    name={contact.display_name}
                    email={contact.email}
                    phone={contact.phone}
                    organizationNames={contact.organization_names}
                    eventNames={contact.event_names}
                  />
                </tr>
              ))}
              {crewContacts?.rows.map((contact) => (
                <tr key={contact.id} className={listRowClassName()}>
                  {access.canAccessOperations ? (
                  <td className="px-4 py-3">
                    <DatasetCheckbox id={contact.id} />
                  </td>
                  ) : null}
                  <PersonCells
                    href={`/contacts/${contact.id}`}
                    name={contact.display_name}
                    email={contact.email}
                    phone={contact.phone}
                    organizationNames={contact.organization_names}
                    eventNames={contact.event_names}
                  />
                </tr>
              ))}
              {prospectContacts?.rows.map((contact) => {
                const personId = contactBulkPersonId(contact.id);
                return (
                <tr
                  key={contact.id}
                  className={contact.href ? listRowClassName() : undefined}
                >
                  {access.canAccessOperations ? (
                  <td className="px-4 py-3">
                    {personId ? <DatasetCheckbox id={personId} /> : null}
                  </td>
                  ) : null}
                  <td className="px-4 py-3">
                    {contact.href ? (
                      <ListRowLink
                        href={contact.href}
                        className="font-semibold text-cyan-700 hover:text-cyan-900"
                      >
                        {contact.display_name}
                      </ListRowLink>
                    ) : (
                      <span className="font-semibold text-slate-900">
                        {contact.display_name}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {contact.email ? (
                      <MailtoLink
                        email={contact.email}
                        className="text-cyan-700 underline hover:text-cyan-900"
                      />
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3">{contact.phone ?? "—"}</td>
                  <td className="px-4 py-3">{contact.race_name ?? "—"}</td>
                </tr>
                );
              })}
              {!rowCount ? (
                <tr>
                  <td
                    colSpan={columnCount}
                    className="px-4 py-12 text-center text-slate-500"
                  >
                    No contacts match this view and its filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
      </div>
      </DatasetBulkRoot>
    </div>
  );
}

function PersonCard({
  href,
  name,
  email,
  phone,
  organizationNames,
  eventNames,
  raceName,
  checkboxId,
}: {
  href?: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  organizationNames?: string[];
  eventNames?: string[];
  raceName?: string | null;
  checkboxId?: string | null;
}) {
  const title = href ? (
    <ListRowLink href={href} className="font-semibold text-cyan-700 hover:text-cyan-900">
      {name}
    </ListRowLink>
  ) : (
    <p className="font-semibold text-slate-900">{name}</p>
  );
  return (
    <article className="relative rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-start gap-3">
        {checkboxId ? <DatasetCheckbox id={checkboxId} /> : null}
        <div className="min-w-0 flex-1 space-y-1">
          {title}
          <p className="text-sm text-slate-600">
            {email ? (
              <MailtoLink email={email} className="text-cyan-700 underline hover:text-cyan-900" />
            ) : (
              "No email"
            )}
            {phone ? ` · ${phone}` : ""}
          </p>
          {organizationNames ? (
            <div className="text-xs text-slate-500">
              <OrganizationChips names={organizationNames} />
            </div>
          ) : null}
          {eventNames ? (
            <p className="text-xs text-slate-500">
              {formatContactEventNames(eventNames) ?? "No events"}
            </p>
          ) : null}
          {raceName !== undefined ? (
            <p className="text-xs text-slate-500">{raceName ?? "—"}</p>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function PersonCells({
  href,
  name,
  email,
  phone,
  organizationNames,
  eventNames,
}: {
  href: string;
  name: string;
  email: string | null;
  phone: string | null;
  organizationNames: string[];
  eventNames?: string[];
}) {
  return (
    <>
      <td className="px-4 py-3">
        <ListRowLink
          href={href}
          className="font-semibold text-cyan-700 hover:text-cyan-900"
        >
          {name}
        </ListRowLink>
      </td>
      <td className="px-4 py-3">
        {email ? (
          <MailtoLink email={email} className="text-cyan-700 underline hover:text-cyan-900" />
        ) : (
          "—"
        )}
      </td>
      <td className="px-4 py-3">{phone ?? "—"}</td>
      <td className="px-4 py-3">
        <OrganizationChips names={organizationNames} />
      </td>
      {eventNames ? (
        <td className="px-4 py-3">
          {formatContactEventNames(eventNames) ?? "—"}
        </td>
      ) : null}
    </>
  );
}

function OrganizationChips({ names }: { names: string[] }) {
  if (!names.length) return "—";
  return (
    <span className="flex flex-wrap gap-1">
      {names.map((name) => (
        <span
          key={name}
          className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
        >
          {name}
        </span>
      ))}
    </span>
  );
}
