import { ArrowLeft, UserRound } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  setContactActiveAction,
  setContactArchivedAction,
  updateContactAction,
} from "@/app/contact-actions";
import { MailtoLink } from "@/components/crm-links";
import { ListRowLink } from "@/components/list-row";
import { listRowClassName } from "@/components/list-row-class";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { getPool } from "@/db";
import { requireOperationsAccess } from "@/lib/auth/server";
import {
  listAttachableOrganizations,
  listContactAssociatedEvents,
  loadContactOrgScope,
} from "@/lib/crm/contact-queries";
import {
  contactAssociatedEventHref,
  contactAssociationLabel,
  formatContactEventDate,
  personInContactScopeSql,
} from "@/lib/crm/contacts";
import { MOBILE_CARDS, TABLE_SCROLL } from "@/lib/crm/layout";
import { parseRouteUuid } from "@/lib/crm/route-id";
import { firstParam } from "@/lib/crm/search-params";

const field = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2";

type ContactDetailParams = {
  edit?: string | string[];
};

export default async function ContactDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ personId: string }>;
  searchParams: Promise<ContactDetailParams>;
}) {
  const personId = parseRouteUuid((await params).personId);
  const access = await requireOperationsAccess();
  const scope = await loadContactOrgScope(access);
  const edit = firstParam((await searchParams).edit) === "details";
  const [contactResult, organizations, associatedEvents] = await Promise.all([
    getPool().query<{
      id: string;
      display_name: string | null;
      first_name: string | null;
      last_name: string | null;
      title: string | null;
      email: string | null;
      phone: string | null;
      notes: string | null;
      is_active: boolean;
      archived_at: string | null;
      organization_ids: string[];
      organization_names: string[];
    }>(
      `
        SELECT
          person.id::text,
          person.display_name,
          person.first_name,
          person.last_name,
          person.title,
          person.email,
          person.phone,
          person.notes,
          person.is_active,
          person.archived_at::text,
          COALESCE(
            array_agg(DISTINCT org.id::text) FILTER (WHERE org.id IS NOT NULL),
            ARRAY[]::text[]
          ) AS organization_ids,
          COALESCE(
            array_agg(DISTINCT org.name ORDER BY org.name)
              FILTER (WHERE org.name IS NOT NULL),
            ARRAY[]::text[]
          ) AS organization_names
        FROM crm.people person
        LEFT JOIN (
          SELECT person_id, organization_id FROM crm.person_organizations
          UNION
          SELECT id, organization_id FROM crm.people
          WHERE organization_id IS NOT NULL
        ) ties ON ties.person_id = person.id
        LEFT JOIN crm.organizations org ON org.id = ties.organization_id
        WHERE person.id = $3::uuid
          AND ${personInContactScopeSql(1, 2)}
        GROUP BY person.id
      `,
      [scope.scopeOrgIds, scope.assignedOrgIds, personId],
    ),
    listAttachableOrganizations(scope.scopeOrgIds),
    listContactAssociatedEvents(personId, scope.assignedOrgIds),
  ]);
  const contact = contactResult.rows[0];
  if (!contact) notFound();
  const selectedOrgIds = new Set(contact.organization_ids);
  const displayName =
    contact.display_name?.trim() ||
    [contact.first_name, contact.last_name].filter(Boolean).join(" ") ||
    "Unnamed contact";

  return (
    <div className="space-y-6">
      <Link href="/contacts" className="inline-flex items-center gap-2 text-sm font-medium text-slate-600">
        <ArrowLeft className="size-4" /> Back to contacts
      </Link>
      <header className="rounded-2xl bg-slate-950 p-6 text-white">
        <div className="flex items-start gap-4">
          <span className="grid size-12 place-items-center rounded-xl bg-cyan-400 text-slate-950">
            <UserRound className="size-6" />
          </span>
          <div>
            <h1 className="text-3xl font-bold">{displayName}</h1>
            <p className="mt-1 text-slate-300">{contact.title || "Contact"}</p>
            <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-cyan-200">
              {contact.archived_at
                ? "Archived"
                : contact.is_active
                  ? "Active"
                  : "Inactive"}
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-5 text-sm text-slate-300">
          {contact.email ? <MailtoLink email={contact.email} className="underline decoration-cyan-400/70 hover:text-white">{contact.email}</MailtoLink> : null}
          {contact.phone ? <a href={`tel:${contact.phone}`}>{contact.phone}</a> : null}
        </div>
        {contact.organization_names.length ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {contact.organization_names.map((name) => (
              <span
                key={name}
                className="rounded-full bg-white/10 px-3 py-1 text-xs text-slate-100"
              >
                {name}
              </span>
            ))}
          </div>
        ) : null}
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold">Contact details</h2>
          {edit ? (
            <Link href={`/contacts/${contact.id}`} className="text-sm font-semibold text-slate-600">
              Cancel
            </Link>
          ) : (
            <Link
              href={`/contacts/${contact.id}?edit=details`}
              className="text-sm font-semibold text-cyan-700"
            >
              Edit
            </Link>
          )}
        </div>
        {edit ? (
          <form action={updateContactAction} className="mt-4 grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="personId" value={contact.id} />
            <label className="text-sm sm:col-span-2">
              Display name
              <input
                name="displayName"
                defaultValue={contact.display_name ?? ""}
                className={field}
              />
            </label>
            <label className="text-sm">
              First name
              <input name="firstName" defaultValue={contact.first_name ?? ""} className={field} />
            </label>
            <label className="text-sm">
              Last name
              <input name="lastName" defaultValue={contact.last_name ?? ""} className={field} />
            </label>
            <label className="text-sm">
              Email
              <input
                type="email"
                name="email"
                defaultValue={contact.email ?? ""}
                className={field}
              />
            </label>
            <label className="text-sm">
              Phone
              <input name="phone" defaultValue={contact.phone ?? ""} className={field} />
            </label>
            <label className="text-sm sm:col-span-2">
              Title
              <input name="title" defaultValue={contact.title ?? ""} className={field} />
            </label>
            <fieldset className="sm:col-span-2">
              <legend className="mb-2 text-sm">Organizations</legend>
              <div className="grid max-h-64 gap-2 overflow-y-auto rounded-lg border border-slate-200 p-3 sm:grid-cols-2">
                {organizations.rows.map((organization) => (
                  <label key={organization.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="organizationIds"
                      value={organization.id}
                      defaultChecked={selectedOrgIds.has(organization.id)}
                    />
                    {organization.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="text-sm sm:col-span-2">
              Notes
              <textarea
                name="notes"
                rows={4}
                defaultValue={contact.notes ?? ""}
                className={field}
              />
            </label>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="hidden" name="isActive" value="false" />
              <input
                type="checkbox"
                name="isActive"
                value="true"
                defaultChecked={contact.is_active}
              />
              Active with this group
            </label>
            <PendingSubmitButton className="rounded-lg bg-cyan-700 px-4 py-2 font-semibold text-white sm:col-span-2">
              Save contact
            </PendingSubmitButton>
          </form>
        ) : (
          <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-slate-500">Email</dt>
              <dd>{contact.email ? <MailtoLink email={contact.email} className="text-cyan-700 underline hover:text-cyan-900" /> : "Not set"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Phone</dt>
              <dd>{contact.phone ?? "Not set"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">First name</dt>
              <dd>{contact.first_name ?? "Not set"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Last name</dt>
              <dd>{contact.last_name ?? "Not set"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-slate-500">Organizations</dt>
              <dd>{contact.organization_names.join(", ") || "None"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-slate-500">Status</dt>
              <dd>{contact.is_active ? "Active" : "Inactive"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-slate-500">Notes</dt>
              <dd className="whitespace-pre-wrap">{contact.notes ?? "None"}</dd>
            </div>
          </dl>
        )}
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-lg font-bold">Events</h2>
          <p className="text-sm text-slate-500">
            Bookings, crew assignments, and prospect races linked to this contact.
          </p>
        </div>
        <div className={`${MOBILE_CARDS} p-3`}>
          {associatedEvents.rows.map((row, index) => {
            const href = contactAssociatedEventHref({
              association: row.association,
              bookingId: row.booking_id,
              prospectId: row.prospect_id,
              eventId: row.event_id,
              canAccessProspecting: access.canAccessProspecting,
            });
            const key = [
              row.association,
              row.event_id,
              row.occurrence_id,
              row.booking_id,
              row.prospect_id,
              index,
            ].join(":");
            return (
              <article
                key={key}
                className="relative rounded-xl border border-slate-200 bg-slate-50 p-3"
              >
                {href ? (
                  <ListRowLink href={href} className="font-semibold">
                    {row.event_name}
                  </ListRowLink>
                ) : (
                  <p className="font-semibold">{row.event_name}</p>
                )}
                <p className="mt-1 text-sm text-slate-600">
                  {row.occurrence_year ?? "—"} · {formatContactEventDate(row.race_date)}
                </p>
                <p className="text-sm text-slate-500">
                  {contactAssociationLabel(row.association, row.role)}
                </p>
                <p className="mt-1 text-sm font-medium">{row.stage_name ?? "—"}</p>
              </article>
            );
          })}
          {associatedEvents.rows.length === 0 ? (
            <p className="p-6 text-center text-slate-500">
              No events linked to this contact yet.
            </p>
          ) : null}
        </div>
        {associatedEvents.rows.length ? (
        <div className="hidden md:block">
          <div className={TABLE_SCROLL}>
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-4 py-3">Event</th>
                  <th className="px-4 py-3">Year</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {associatedEvents.rows.map((row, index) => {
                  const href = contactAssociatedEventHref({
                    association: row.association,
                    bookingId: row.booking_id,
                    prospectId: row.prospect_id,
                    eventId: row.event_id,
                    canAccessProspecting: access.canAccessProspecting,
                  });
                  const key = [
                    row.association,
                    row.event_id,
                    row.occurrence_id,
                    row.booking_id,
                    row.prospect_id,
                    index,
                  ].join(":");
                  return (
                    <tr
                      key={key}
                      className={href ? listRowClassName() : "hover:bg-slate-50"}
                    >
                      <td className="px-4 py-3 font-semibold">
                        {href ? (
                          <ListRowLink href={href} className="font-semibold">
                            {row.event_name}
                          </ListRowLink>
                        ) : (
                          row.event_name
                        )}
                      </td>
                      <td className="px-4 py-3">{row.occurrence_year ?? "—"}</td>
                      <td className="px-4 py-3">
                        {formatContactEventDate(row.race_date)}
                      </td>
                      <td className="px-4 py-3">
                        {contactAssociationLabel(row.association, row.role)}
                      </td>
                      <td className="px-4 py-3">{row.stage_name ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        ) : null}
        {associatedEvents.rows.length === 0 ? (
          <p className="hidden p-10 text-center text-slate-500 md:block">
            No events linked to this contact yet.
          </p>
        ) : null}
      </section>

      {!contact.archived_at ? (
        <form action={setContactActiveAction} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <input type="hidden" name="personId" value={contact.id} />
          <input type="hidden" name="isActive" value={contact.is_active ? "false" : "true"} />
          <p className="text-sm text-slate-600">
            Inactive contacts stay on file but no longer appear in crew search.
            Use notes to record why they left the group.
          </p>
          <PendingSubmitButton
            className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
            pendingLabel="Saving…"
          >
            {contact.is_active ? "Mark inactive" : "Mark active"}
          </PendingSubmitButton>
        </form>
      ) : null}

      <form action={setContactArchivedAction} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <input type="hidden" name="personId" value={contact.id} />
        <input
          type="hidden"
          name="operation"
          value={contact.archived_at ? "restore" : "archive"}
        />
        <PendingSubmitButton
          className={`rounded-lg px-4 py-2 text-sm font-semibold ${
            contact.archived_at
              ? "bg-cyan-700 text-white"
              : "bg-red-50 text-red-800"
          }`}
          pendingLabel={contact.archived_at ? "Restoring…" : "Archiving…"}
        >
          {contact.archived_at ? "Restore contact" : "Archive contact"}
        </PendingSubmitButton>
      </form>
    </div>
  );
}
