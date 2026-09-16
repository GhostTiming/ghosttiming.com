import { ArrowLeft, Building2, CalendarDays, UserPlus } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  addOrganizationPersonAction,
  addOrganizationRelationshipAction,
  archiveOrganizationPersonAction,
  removeOrganizationRelationshipAction,
  updateOrganizationAction,
  updateOrganizationPersonAction,
  updateOrganizationRelationshipAction,
} from "@/app/organization-actions";
import {
  permanentlyDeleteOrganizationAction,
  setOrganizationArchivedAction,
} from "@/app/lifecycle-actions";
import { getPool } from "@/db";
import { requireOperationsAccess } from "@/lib/auth/server";

function yearLabel(event: {
  occurrence_count: number;
  year_count: number;
  first_year: number | null;
  last_year: number | null;
}) {
  const races =
    event.occurrence_count === 1 ? "1 race" : `${event.occurrence_count} races`;
  if (!event.first_year || !event.last_year) {
    return races;
  }
  if (event.first_year === event.last_year) {
    return `${event.first_year} · ${races}`;
  }
  const years = event.year_count === 1 ? "1 year" : `${event.year_count} years`;
  return `${event.first_year}–${event.last_year} · ${years}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "America/New_York",
  }).format(new Date(value));
}

export default async function OrganizationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const access = await requireOperationsAccess();
  const { organizationId } = await params;
  const { edit } = await searchParams;
  const organizationResult = await getPool().query<{
    id: string;
    archived_at: string | null;
    name: string;
    website: string | null;
    phone: string | null;
    email: string | null;
    address: string;
    street: string | null;
    street2: string | null;
    city: string | null;
    state: string | null;
    zipcode: string | null;
    notes: string | null;
    roles: string[];
  }>(
    `
      SELECT
        org.id::text,
        org.archived_at::text,
        org.name,
        org.website,
        org.phone,
        org.email,
        org.street, org.street2, org.city, org.state, org.zipcode,
        concat_ws(', ', NULLIF(org.street, ''), NULLIF(org.street2, ''),
          NULLIF(org.city, ''), NULLIF(org.state, ''), NULLIF(org.zipcode, '')) AS address,
        org.notes,
        COALESCE(array_agg(role.role::text ORDER BY role.role)
          FILTER (WHERE role.role IS NOT NULL), ARRAY[]::text[]) AS roles
      FROM crm.organizations org
      LEFT JOIN crm.organization_roles role ON role.organization_id = org.id
      WHERE org.id = $1::uuid
      GROUP BY org.id
    `,
    [organizationId],
  );
  const organization = organizationResult.rows[0];
  if (!organization) notFound();
  if (!access.canAccessOrganization(organization.id)) notFound();

  const [people, relationships, events, bookings, allOrganizations] =
    await Promise.all([
      getPool().query<{
        id: string;
        display_name: string;
        title: string | null;
        email: string | null;
        phone: string | null;
        first_name: string | null;
        last_name: string | null;
        contact_type: string | null;
        street: string | null;
        city: string | null;
        state: string | null;
        zipcode: string | null;
        notes: string | null;
        do_not_contact: boolean;
        email_opt_out: boolean;
      }>(
        `
          SELECT id::text, display_name, first_name, last_name, title,
            contact_type, email, phone, street, city, state, zipcode, notes,
            do_not_contact, email_opt_out
          FROM crm.people person
          WHERE person.is_active = true
            AND (
              person.organization_id = $1::uuid
              OR EXISTS (
                SELECT 1 FROM crm.person_organizations membership
                WHERE membership.person_id = person.id
                  AND membership.organization_id = $1::uuid
              )
            )
          ORDER BY person.display_name
        `,
        [organizationId],
      ),
      getPool().query<{
        id: string;
        direction: string;
        related_id: string;
        related_name: string;
        relationship_type: string;
        notes: string | null;
      }>(
        `
          SELECT
            relationship.id::text,
            CASE WHEN relationship.source_organization_id = $1::uuid
              THEN 'client of' ELSE 'has client' END AS direction,
            related.id::text AS related_id,
            related.name AS related_name,
            relationship.relationship_type,
            relationship.notes
          FROM crm.organization_relationships relationship
          JOIN crm.organizations related ON related.id = CASE
            WHEN relationship.source_organization_id = $1::uuid
              THEN relationship.target_organization_id
            ELSE relationship.source_organization_id
          END
          WHERE relationship.source_organization_id = $1::uuid
             OR relationship.target_organization_id = $1::uuid
          ORDER BY related.name
        `,
        [organizationId],
      ),
      getPool().query<{
        id: string;
        name: string;
        occurrence_count: number;
        year_count: number;
        first_year: number | null;
        last_year: number | null;
      }>(
        `
          SELECT event.id::text, event.name,
            COUNT(DISTINCT occurrence.id)::integer AS occurrence_count,
            COUNT(DISTINCT occurrence.occurrence_year)::integer AS year_count,
            MIN(occurrence.occurrence_year) AS first_year,
            MAX(occurrence.occurrence_year) AS last_year
          FROM crm.events event
          LEFT JOIN crm.event_occurrences occurrence ON occurrence.event_id = event.id
          WHERE event.archived_at IS NULL
            AND (
              event.default_owner_organization_id = $1::uuid
              OR occurrence.event_owner_organization_id = $1::uuid
            )
          GROUP BY event.id
          ORDER BY event.name
        `,
        [organizationId],
      ),
      getPool().query<{
        id: string;
        event_name: string;
        race_date: string | null;
        stage_name: string;
      }>(
        `
          SELECT booking.id::text, event.name AS event_name,
            occurrence.race_date::text, stage.name AS stage_name
          FROM crm.bookings booking
          JOIN crm.event_occurrences occurrence ON occurrence.id = booking.occurrence_id
          JOIN crm.events event ON event.id = occurrence.event_id
          JOIN crm.pipeline_stages stage ON stage.id = booking.stage_id
          WHERE booking.direct_client_organization_id = $1::uuid
             OR occurrence.event_owner_organization_id = $1::uuid
          ORDER BY occurrence.race_date DESC NULLS LAST
        `,
        [organizationId],
      ),
      getPool().query<{ id: string; name: string }>(
        `
          SELECT id::text, name FROM crm.organizations
          WHERE is_active = true AND id <> $1::uuid
          ORDER BY name
        `,
        [organizationId],
      ),
    ]);

  return (
    <div className="space-y-6">
      <Link href="/organizations" className="inline-flex items-center gap-2 text-sm font-medium text-slate-600">
        <ArrowLeft className="size-4" /> Back to organizations
      </Link>
      <header className="rounded-2xl bg-slate-950 p-6 text-white">
        <div className="flex items-start gap-4">
          <span className="grid size-12 place-items-center rounded-xl bg-cyan-400 text-slate-950">
            <Building2 className="size-6" />
          </span>
          <div>
            <h1 className="text-3xl font-bold">{organization.name}</h1>
            <p className="mt-1 capitalize text-slate-300">
              {organization.roles.map((role) => role.replaceAll("_", " ")).join(" · ")}
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-5 text-sm text-slate-300">
          {organization.email ? <a href={`mailto:${organization.email}`}>{organization.email}</a> : null}
          {organization.phone ? <a href={`tel:${organization.phone}`}>{organization.phone}</a> : null}
          {organization.website ? <a className="underline" href={organization.website}>Website</a> : null}
          {organization.address ? <span>{organization.address}</span> : null}
        </div>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold">Organization details</h2>
          {edit === "details" ? (
            <Link href={`/organizations/${organization.id}`} className="text-sm font-semibold text-slate-600">Cancel</Link>
          ) : (
            <Link href={`/organizations/${organization.id}?edit=details`} className="text-sm font-semibold text-cyan-700">Edit</Link>
          )}
        </div>
        {edit === "details" ? (
          <form action={updateOrganizationAction} className="mt-4 grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="organizationId" value={organization.id} />
            <label className="text-sm sm:col-span-2">Name<input required name="name" defaultValue={organization.name} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
            <label className="text-sm">Website<input type="url" name="website" defaultValue={organization.website ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
            <label className="text-sm">Email<input type="email" name="email" defaultValue={organization.email ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
            <label className="text-sm">Phone<input name="phone" defaultValue={organization.phone ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
            <label className="text-sm">Street<input name="street" defaultValue={organization.street ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
            <label className="text-sm">Street 2<input name="street2" defaultValue={organization.street2 ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
            <label className="text-sm">City<input name="city" defaultValue={organization.city ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
            <label className="text-sm">State<input name="state" defaultValue={organization.state ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
            <label className="text-sm">ZIP code<input name="zipcode" defaultValue={organization.zipcode ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
            <fieldset className="sm:col-span-2"><legend className="mb-2 text-sm">Roles</legend><div className="flex flex-wrap gap-4">{[["direct_client", "Direct client"], ["event_owner", "Event owner"], ["timing_company", "Timing company"], ["other", "Other"]].map(([value, label]) => <label key={value} className="text-sm"><input type="checkbox" name="roles" value={value} defaultChecked={organization.roles.includes(value)} className="mr-2" />{label}</label>)}</div></fieldset>
            <label className="text-sm sm:col-span-2">Notes<textarea name="notes" rows={4} defaultValue={organization.notes ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
            <button className="rounded-lg bg-cyan-700 px-4 py-2 font-semibold text-white sm:col-span-2">Save organization</button>
          </form>
        ) : (
          <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
            <div><dt className="text-slate-500">Email</dt><dd>{organization.email ?? "Not set"}</dd></div>
            <div><dt className="text-slate-500">Phone</dt><dd>{organization.phone ?? "Not set"}</dd></div>
            <div><dt className="text-slate-500">Website</dt><dd>{organization.website ?? "Not set"}</dd></div>
            <div><dt className="text-slate-500">Address</dt><dd>{organization.address || "Not set"}</dd></div>
            <div className="sm:col-span-2"><dt className="text-slate-500">Notes</dt><dd className="whitespace-pre-wrap">{organization.notes ?? "None"}</dd></div>
          </dl>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold">Contacts</h2>
          <div className="mt-4 divide-y divide-slate-100">
            {people.rows.map((person) => (
              <details key={person.id} className="py-3 first:pt-0">
                <summary className="cursor-pointer">
                  <Link href={`/contacts/${person.id}`} className="font-semibold text-cyan-700 hover:text-cyan-900">
                    {person.display_name}
                  </Link>
                  <span className="ml-2 text-sm text-slate-500">{[person.title, person.email, person.phone].filter(Boolean).join(" · ")}</span>
                </summary>
                <form action={updateOrganizationPersonAction} className="mt-3 grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-2">
                  <input type="hidden" name="organizationId" value={organization.id} />
                  <input type="hidden" name="personId" value={person.id} />
                  <label className="text-sm sm:col-span-2">Display name<input required name="displayName" defaultValue={person.display_name} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
                  <label className="text-sm">First name<input name="firstName" defaultValue={person.first_name ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
                  <label className="text-sm">Last name<input name="lastName" defaultValue={person.last_name ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
                  <label className="text-sm">Title<input name="title" defaultValue={person.title ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
                  <label className="text-sm">Contact type<input name="contactType" defaultValue={person.contact_type ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
                  <label className="text-sm">Email<input type="email" name="email" defaultValue={person.email ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
                  <label className="text-sm">Phone<input name="phone" defaultValue={person.phone ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
                  <label className="text-sm sm:col-span-2">Street<input name="street" defaultValue={person.street ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
                  <label className="text-sm">City<input name="city" defaultValue={person.city ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
                  <label className="text-sm">State<input name="state" defaultValue={person.state ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
                  <label className="text-sm">ZIP code<input name="zipcode" defaultValue={person.zipcode ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="doNotContact" defaultChecked={person.do_not_contact} /> Do not contact</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="emailOptOut" defaultChecked={person.email_opt_out} /> Email opt-out</label>
                  <label className="text-sm sm:col-span-2">Notes<textarea name="notes" defaultValue={person.notes ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
                  <button className="rounded-lg bg-cyan-700 px-3 py-2 font-semibold text-white sm:col-span-2">Save contact</button>
                </form>
                <form action={archiveOrganizationPersonAction} className="mt-2">
                  <input type="hidden" name="organizationId" value={organization.id} />
                  <input type="hidden" name="personId" value={person.id} />
                  <button className="text-sm font-semibold text-red-700">Archive contact</button>
                </form>
              </details>
            ))}
            {!people.rows.length ? <p className="pb-3 text-sm text-slate-500">No known contacts yet.</p> : null}
          </div>
          <form action={addOrganizationPersonAction} className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2">
            <input type="hidden" name="organizationId" value={organization.id} />
            <label className="text-sm sm:col-span-2">Name<input required name="displayName" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
            <label className="text-sm">Title<input name="title" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
            <label className="text-sm">Phone<input name="phone" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
            <label className="text-sm sm:col-span-2">Email<input name="email" type="email" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
            <button className="inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-700 px-4 py-2 font-semibold text-white sm:col-span-2">
              <UserPlus className="size-4" /> Add contact
            </button>
          </form>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold">Organization relationships</h2>
          <div className="mt-4 space-y-2">
            {relationships.rows.map((relationship) => (
              <details key={relationship.id} className="rounded-lg bg-slate-50 p-3 text-sm">
                <summary className="cursor-pointer">{organization.name} {relationship.direction}{" "}
                  <Link className="font-semibold text-cyan-700" href={`/organizations/${relationship.related_id}`}>{relationship.related_name}</Link>
                </summary>
                <form action={updateOrganizationRelationshipAction} className="mt-3 space-y-2">
                  <input type="hidden" name="organizationId" value={organization.id} />
                  <input type="hidden" name="relationshipId" value={relationship.id} />
                  <label className="block">Relationship type<input required name="relationshipType" defaultValue={relationship.relationship_type} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
                  <label className="block">Notes<input name="notes" defaultValue={relationship.notes ?? ""} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
                  <button className="font-semibold text-cyan-700">Save relationship</button>
                </form>
                <form action={removeOrganizationRelationshipAction} className="mt-2">
                  <input type="hidden" name="organizationId" value={organization.id} />
                  <input type="hidden" name="relationshipId" value={relationship.id} />
                  <button className="font-semibold text-red-700">Remove relationship</button>
                </form>
              </details>
            ))}
            {!relationships.rows.length ? <p className="text-sm text-slate-500">No relationships yet.</p> : null}
          </div>
          <form action={addOrganizationRelationshipAction} className="mt-4 space-y-3 border-t border-slate-100 pt-4">
            <input type="hidden" name="sourceOrganizationId" value={organization.id} />
            <label className="block text-sm">This organization is a client of
              <select required name="targetOrganizationId" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
                <option value="">Select organization</option>
                {allOrganizations.rows.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <button className="w-full rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white">Add relationship</button>
          </form>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold">Events</h2>
          <div className="mt-4 space-y-3">
            {events.rows.map((event) => (
              <Link
                key={event.id}
                href={`/events/${event.id}`}
                className="flex items-center gap-3 rounded-lg bg-slate-50 p-3 hover:ring-2 hover:ring-cyan-500"
              >
                <CalendarDays className="size-5 shrink-0 text-cyan-700" />
                <div className="min-w-0">
                  <p className="font-semibold">{event.name}</p>
                  <p className="text-sm text-slate-500">{yearLabel(event)}</p>
                </div>
              </Link>
            ))}
            {!events.rows.length ? <p className="text-sm text-slate-500">No owned events yet.</p> : null}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold">Booking history</h2>
          <div className="mt-4 space-y-3">
            {bookings.rows.map((booking) => (
              <Link key={booking.id} href={`/bookings/${booking.id}`} className="flex items-center gap-3 rounded-lg bg-slate-50 p-3 hover:ring-2 hover:ring-cyan-500">
                <CalendarDays className="size-5 text-cyan-700" />
                <div>
                  <p className="font-semibold">{booking.event_name}</p>
                  <p className="text-sm text-slate-500">{booking.race_date ? formatDate(booking.race_date) : "Date TBD"} · {booking.stage_name}</p>
                </div>
              </Link>
            ))}
            {!bookings.rows.length ? <p className="text-sm text-slate-500">No booking history yet.</p> : null}
          </div>
        </section>
      </div>
      {organization.notes ? <section className="rounded-xl bg-amber-50 p-5 text-sm text-amber-950"><strong>Notes:</strong> {organization.notes}</section> : null}
      <section className="rounded-xl border border-red-200 bg-red-50 p-5">
        <h2 className="font-bold text-red-950">Danger zone</h2>
        {organization.archived_at ? (
          <div className="mt-3 space-y-4">
            <form action={setOrganizationArchivedAction}>
              <input type="hidden" name="organizationId" value={organization.id} />
              <input type="hidden" name="operation" value="restore" />
              <button className="rounded-lg border bg-white px-4 py-2 font-semibold">Restore organization</button>
            </form>
            <form action={permanentlyDeleteOrganizationAction} className="space-y-2">
              <p className="text-sm text-red-900">Deletion is blocked when bookings, owned events, occurrences, or linked contacts depend on this organization.</p>
              <label className="block text-sm">Type DELETE to confirm.
                <input required name="confirmation" className="mt-1 block rounded-lg border border-red-300 px-3 py-2" />
              </label>
              <input type="hidden" name="organizationId" value={organization.id} />
              <button className="rounded-lg bg-red-700 px-4 py-2 font-semibold text-white">Permanently delete</button>
            </form>
          </div>
        ) : (
          <form action={setOrganizationArchivedAction} className="mt-3">
            <input type="hidden" name="organizationId" value={organization.id} />
            <input type="hidden" name="operation" value="archive" />
            <button className="rounded-lg bg-red-700 px-4 py-2 font-semibold text-white">Archive organization</button>
          </form>
        )}
      </section>
    </div>
  );
}
