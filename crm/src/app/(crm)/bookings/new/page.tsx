import Link from "next/link";
import { createManualBookingAction } from "@/app/booking-actions";
import { CreateFromOnlineEvent } from "@/components/create-from-online-event";
import { getPool } from "@/db";
import { bookingOrgScopeParam } from "@/lib/auth/access";
import { requireOperationsAccess } from "@/lib/auth/server";

const field = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2";

export default async function NewBookingPage() {
  const access = await requireOperationsAccess();
  const orgScope = bookingOrgScopeParam(access);
  const [organizations, people, users, stages] = await Promise.all([
    getPool().query<{ id: string; name: string }>(
      `SELECT id::text, name FROM crm.organizations
       WHERE is_active AND archived_at IS NULL
         AND ($1::uuid[] IS NULL OR id = ANY($1::uuid[]))
       ORDER BY name`,
      [orgScope],
    ),
    getPool().query<{ id: string; display_name: string }>(
      `SELECT id::text, display_name FROM crm.people
       WHERE is_active AND archived_at IS NULL ORDER BY display_name`,
    ),
    getPool().query<{ id: string; name: string }>(
      `SELECT id::text, name FROM crm.users WHERE is_active ORDER BY name`,
    ),
    getPool().query<{ key: string; name: string }>(
      `SELECT key, name FROM crm.pipeline_stages
       WHERE pipeline = 'booking' AND is_active ORDER BY sort_order`,
    ),
  ]);
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <Link href="/bookings" className="text-sm font-semibold text-cyan-700">
          ← Back to bookings
        </Link>
        <h1 className="mt-2 text-3xl font-bold">Add booking</h1>
        {/* Online listing search sits above the manual form. */}
        <p className="text-slate-600">
          Pull a race from the online catalog or RunSignUp, or create private
          CRM event and booking records by hand.
        </p>
      </header>
      <CreateFromOnlineEvent
        organizations={organizations.rows}
        people={people.rows}
        users={users.rows}
        stages={stages.rows}
        canViewFinancials={access.canViewAnyFinancials}
      />
      <section className="space-y-3">
        <h2 className="text-lg font-bold text-slate-950">Create manually</h2>
      <form action={createManualBookingAction}
        className="grid gap-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm md:grid-cols-2">
        <label className="text-sm">Event name
          <input required name="eventName" className={field} />
        </label>
        <label className="text-sm">Date and start time
          <input required name="raceDate" type="datetime-local" className={field} />
        </label>
        <label className="text-sm">Timezone
          <input required name="timezone" defaultValue="America/New_York" className={field} />
        </label>
        <label className="text-sm">Stage
          <select name="stageKey" defaultValue="confirmed" className={field}>
            {stages.rows.map((item) =>
              <option key={item.key} value={item.key}>{item.name}</option>)}
          </select>
        </label>
        <label className="text-sm">Direct client
          <select required name="directClientId" className={field}>
            <option value="">Choose organization</option>
            {organizations.rows.map((item) =>
              <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="text-sm">Event owner
          <select name="eventOwnerId" className={field}>
            <option value="">None</option>
            {organizations.rows.map((item) =>
              <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="text-sm">Primary contact
          <select name="primaryContactPersonId" className={field}>
            <option value="">None</option>
            {people.rows.map((item) =>
              <option key={item.id} value={item.id}>{item.display_name}</option>)}
          </select>
        </label>
        <label className="text-sm">Assignee
          <select name="assignedUserId" className={field}>
            <option value="">Me</option>
            {users.rows.map((item) =>
              <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        {access.canViewAnyFinancials ? (
        <label className="text-sm">Expected revenue
          <input name="expectedRevenue" type="number" min="0" step="0.01" className={field} />
        </label>
        ) : null}
        <label className="text-sm">Registration URL
          <input name="registrationUrl" type="url" className={field} />
        </label>
        <label className="text-sm md:col-span-2">Street
          <input name="street" className={field} />
        </label>
        <label className="text-sm">Street 2<input name="street2" className={field} /></label>
        <label className="text-sm">City<input name="city" className={field} /></label>
        <label className="text-sm">State<input name="state" className={field} /></label>
        <label className="text-sm">ZIP code<input name="zipcode" className={field} /></label>
        <label className="text-sm md:col-span-2">Notes
          <textarea name="notes" rows={4} className={field} />
        </label>
        <div className="flex justify-end gap-3 md:col-span-2">
          <Link href="/bookings" className="rounded-lg border px-4 py-2">Cancel</Link>
          <button className="rounded-lg bg-cyan-700 px-5 py-2 font-semibold text-white">
            Create booking
          </button>
        </div>
      </form>
      </section>
    </div>
  );
}

