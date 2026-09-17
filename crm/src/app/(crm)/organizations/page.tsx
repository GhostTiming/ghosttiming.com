import { Plus } from "lucide-react";
import Link from "next/link";
import { bulkUpdateOrganizationsAction } from "@/app/bulk-actions";
import { createOrganizationAction } from "@/app/organization-actions";
import {
  DatasetBulkBar,
  DatasetBulkRoot,
  DatasetCheckbox,
  DatasetHeaderCheckbox,
} from "@/components/dataset-bulk";
import { MailtoLink } from "@/components/crm-links";
import { ListRowLink } from "@/components/list-row";
import { listRowClassName } from "@/components/list-row-class";
import { TableColumnHeader } from "@/components/table-column-header";
import { getPool } from "@/db";
import { requireOperationsAccess } from "@/lib/auth/server";
import { bookingOrgScopeParam } from "@/lib/auth/access";
import { organizationBulkFields } from "@/lib/crm/bulk-fields";
import { CHIP_ROW } from "@/lib/crm/layout";
import { buildSearchHref, firstParam, parseOptionalInteger } from "@/lib/crm/search-params";

const roleFilters = [
  ["direct_client", "Direct Clients"],
  ["event_owner", "Client Organizations"],
  ["timing_company", "Timing Companies"],
] as const;

const presenceOptions = [
  { value: "all", label: "Any" },
  { value: "has", label: "Has value" },
  { value: "missing", label: "Missing" },
];

type OrganizationParams = {
  role?: string | string[];
  archived?: string | string[];
  q?: string | string[];
  email?: string | string[];
  phone?: string | string[];
  contactsMin?: string | string[];
  bookingsMin?: string | string[];
  sort?: string | string[];
  direction?: string | string[];
};

export default async function OrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<OrganizationParams>;
}) {
  const access = await requireOperationsAccess();
  const params = await searchParams;
  const current = {
    role: firstParam(params.role),
    archived: firstParam(params.archived),
    q: firstParam(params.q),
    email: firstParam(params.email) || "all",
    phone: firstParam(params.phone) || "all",
    contactsMin: firstParam(params.contactsMin),
    bookingsMin: firstParam(params.bookingsMin),
    sort: firstParam(params.sort),
    direction: firstParam(params.direction) || "asc",
  };
  const showArchived = current.archived === "1";
  const sortExpressions: Record<string, string> = {
    name: "lower(org.name)",
    email: "lower(org.email)",
    phone: "org.phone",
    contacts: "COUNT(DISTINCT person.id)",
    bookings: "COUNT(DISTINCT booking.id)",
  };
  const sort = sortExpressions[current.sort ?? ""] ? current.sort! : "name";
  const direction = current.direction === "desc" ? "DESC" : "ASC";
  const organizations = await getPool().query<{
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    website: string | null;
    roles: string[];
    contact_count: number;
    booking_count: number;
  }>(
    `
      SELECT
        org.id::text,
        org.name,
        org.email,
        org.phone,
        org.website,
        COALESCE(array_agg(DISTINCT roles.role::text)
          FILTER (WHERE roles.role IS NOT NULL), ARRAY[]::text[]) AS roles,
        COUNT(DISTINCT person.id)::integer AS contact_count,
        COUNT(DISTINCT booking.id)::integer AS booking_count
      FROM crm.organizations org
      LEFT JOIN crm.organization_roles roles ON roles.organization_id = org.id
      LEFT JOIN crm.people person
        ON person.is_active = true AND (
          person.organization_id = org.id
          OR EXISTS (
            SELECT 1 FROM crm.person_organizations membership
            WHERE membership.person_id = person.id
              AND membership.organization_id = org.id
          )
        )
      LEFT JOIN crm.bookings booking
        ON booking.direct_client_organization_id = org.id
      WHERE (($2::boolean AND org.archived_at IS NOT NULL)
        OR (NOT $2::boolean AND org.is_active = true AND org.archived_at IS NULL))
        AND ($8::uuid[] IS NULL OR org.id = ANY($8::uuid[]))
        AND ($1::text IS NULL OR EXISTS (
          SELECT 1 FROM crm.organization_roles selected_role
          WHERE selected_role.organization_id = org.id
            AND selected_role.role::text = $1
        ))
        AND ($3::text IS NULL OR org.name ILIKE '%' || $3::text || '%')
        AND (
          $4::text IS NULL OR $4::text = 'all'
          OR ($4::text = 'has' AND org.email IS NOT NULL AND org.email <> '')
          OR ($4::text = 'missing' AND (org.email IS NULL OR org.email = ''))
        )
        AND (
          $5::text IS NULL OR $5::text = 'all'
          OR ($5::text = 'has' AND org.phone IS NOT NULL AND org.phone <> '')
          OR ($5::text = 'missing' AND (org.phone IS NULL OR org.phone = ''))
        )
      GROUP BY org.id
      HAVING ($6::integer IS NULL OR COUNT(DISTINCT person.id) >= $6::integer)
        AND ($7::integer IS NULL OR COUNT(DISTINCT booking.id) >= $7::integer)
      ORDER BY ${sortExpressions[sort]} ${direction} NULLS LAST, org.name
    `,
    [
      current.role || null,
      showArchived,
      current.q?.trim() || null,
      current.email,
      current.phone,
      parseOptionalInteger(current.contactsMin),
      parseOptionalInteger(current.bookingsMin),
      bookingOrgScopeParam(access),
    ],
  );
  const column = (
    label: string,
    sortKey: string,
    filters?: Parameters<typeof TableColumnHeader>[0]["filters"],
    align?: "left" | "right",
  ) => (
    <TableColumnHeader
      label={label}
      pathname="/organizations"
      params={current}
      sortKey={sortKey}
      currentSort={current.sort}
      currentDirection={current.direction === "desc" ? "desc" : "asc"}
      filters={filters}
      align={align}
    />
  );
  const chipClass = (active: boolean) =>
    `rounded-full px-3 py-1.5 text-sm ring-1 ${
      active
        ? "bg-slate-900 text-white ring-slate-900"
        : "bg-white ring-slate-200"
    }`;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-cyan-700">
            Relationships
          </p>
          <h1 className="text-3xl font-bold text-slate-950">Organizations</h1>
          <p className="mt-1 text-slate-600">
            Clients, event owners, timing companies, and their people.
          </p>
        </div>
        {access.isSuperAdmin ? (
        <Link href="/organizations/new"
          className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white">
          <Plus className="mr-1 inline size-4" /> Add organization
        </Link>
        ) : null}
      </header>

      <nav className={CHIP_ROW}>
        <Link
          href={buildSearchHref("/organizations", current, {
            role: null,
            archived: null,
          })}
          className={chipClass(!current.role && !showArchived)}
        >
          All
        </Link>
        {roleFilters.map(([key, label]) => (
          <Link
            key={key}
            href={buildSearchHref("/organizations", current, {
              role: key,
              archived: null,
            })}
            className={chipClass(current.role === key && !showArchived)}
          >
            {label}
          </Link>
        ))}
        <Link
          href={buildSearchHref("/organizations", current, {
            archived: "1",
            role: null,
          })}
          className={chipClass(showArchived)}
        >
          Archived
        </Link>
      </nav>

      <div className={`grid gap-6 ${access.isSuperAdmin ? "lg:grid-cols-[1fr_23rem]" : ""}`}>
        <DatasetBulkRoot>
        <div className="space-y-3">
        {access.isSuperAdmin ? (
          <DatasetBulkBar
            noun="organizations"
            fields={organizationBulkFields}
            updateAction={bulkUpdateOrganizationsAction}
          />
        ) : null}
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  {access.isSuperAdmin ? (
                  <th className="w-10 px-4 py-3">
                    <DatasetHeaderCheckbox
                      ids={organizations.rows.map((organization) => organization.id)}
                    />
                  </th>
                  ) : null}
                  <th className="px-4 py-3">
                    {column("Organization", "name", [
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
                  <th className="px-4 py-3">
                    {column("Contacts", "contacts", [
                      {
                        type: "number",
                        name: "contactsMin",
                        label: "At least this many contacts",
                        placeholder: "1",
                        min: 0,
                      },
                    ])}
                  </th>
                  <th className="px-4 py-3">
                    {column("Bookings", "bookings", [
                      {
                        type: "number",
                        name: "bookingsMin",
                        label: "At least this many bookings",
                        placeholder: "1",
                        min: 0,
                      },
                    ], "right")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {organizations.rows.map((organization) => (
                  <tr key={organization.id} className={listRowClassName()}>
                    {access.isSuperAdmin ? (
                    <td className="px-4 py-3">
                      <DatasetCheckbox id={organization.id} />
                    </td>
                    ) : null}
                    <td className="px-4 py-3">
                      <ListRowLink
                        href={`/organizations/${organization.id}`}
                        className="font-semibold text-cyan-700 hover:text-cyan-900"
                      >
                        <span>
                          <span className="block">{organization.name}</span>
                          <span className="block truncate text-xs font-normal text-slate-500">
                            {organization.roles.map((item) => item.replaceAll("_", " ")).join(" · ") || "No roles"}
                          </span>
                        </span>
                      </ListRowLink>
                    </td>
                    <td className="px-4 py-3">
                      {organization.email ? (
                        <MailtoLink
                          email={organization.email}
                          className="text-cyan-700 underline hover:text-cyan-900"
                        />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3">{organization.phone ?? "—"}</td>
                    <td className="px-4 py-3">{organization.contact_count}</td>
                    <td className="px-4 py-3">{organization.booking_count}</td>
                  </tr>
                ))}
                {!organizations.rows.length ? (
                  <tr>
                    <td colSpan={access.isSuperAdmin ? 6 : 5} className="px-4 py-12 text-center text-slate-500">
                      No organizations match this view and its filters.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
        </div>
        </DatasetBulkRoot>

        {access.isSuperAdmin ? (
        <aside className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <Plus className="size-5 text-cyan-700" /> Add organization
          </h2>
          <form action={createOrganizationAction} className="mt-4 space-y-3">
            <label className="block text-sm">Name<input required name="name" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
            <label className="block text-sm">Website<input name="website" type="url" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
            <label className="block text-sm">Email<input name="email" type="email" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
            <label className="block text-sm">Phone<input name="phone" type="tel" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
            <fieldset>
              <legend className="mb-2 text-sm">Roles</legend>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {[
                  ["direct_client", "Direct client"],
                  ["event_owner", "Event owner"],
                  ["timing_company", "Timing company"],
                  ["other", "Other"],
                ].map(([value, label]) => (
                  <label key={value} className="flex items-center gap-2">
                    <input type="checkbox" name="roles" value={value} /> {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="block text-sm">Notes<textarea name="notes" rows={3} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
            <button className="w-full rounded-lg bg-cyan-700 px-4 py-2 font-semibold text-white">
              Create organization
            </button>
          </form>
        </aside>
        ) : null}
      </div>
    </div>
  );
}
