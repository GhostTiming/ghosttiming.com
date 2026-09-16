import Link from "next/link";
import { createManualProspectAction } from "@/app/prospect-actions";
import { getPool } from "@/db";
import { requireProspectingAccess } from "@/lib/auth/server";

const field = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2";

export default async function NewProspectPage() {
  const access = await requireProspectingAccess();
  const [stages, users, organizations] = await Promise.all([
    getPool().query<{ key: string; name: string }>(
      `SELECT key, name FROM crm.pipeline_stages
       WHERE pipeline = 'prospect' AND is_active ORDER BY sort_order`,
    ),
    getPool().query<{ id: string; name: string }>(
      `SELECT id::text, name FROM crm.users WHERE is_active ORDER BY name`,
    ),
    getPool().query<{ id: string; name: string }>(
      `SELECT id::text, name FROM crm.organizations
       WHERE is_active AND archived_at IS NULL
         AND ($1::uuid[] IS NULL OR id = ANY($1::uuid[]))
       ORDER BY name`,
      [
        access.isSuperAdmin || access.assignedOrgIds.length === 0
          ? null
          : access.assignedOrgIds,
      ],
    ),
  ]);
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <Link href="/prospecting" className="text-sm font-semibold text-cyan-700">
          ← Back to prospecting
        </Link>
        <h1 className="mt-2 text-3xl font-bold">Add manual lead</h1>
        <p className="text-slate-600">This information stays private to the CRM.</p>
      </header>
      <form action={createManualProspectAction}
        className="grid gap-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm md:grid-cols-2">
        <label className="text-sm md:col-span-2">Event name
          <input required name="eventName" className={field} />
        </label>
        <label className="text-sm">Date and start time
          <input name="raceDate" type="datetime-local" className={field} />
        </label>
        <label className="text-sm">Timezone
          <input required name="timezone" defaultValue="America/New_York" className={field} />
        </label>
        <label className="text-sm">Stage
          <select name="stageKey" defaultValue="cold" className={field}>
            {stages.rows.map((item) =>
              <option key={item.key} value={item.key}>{item.name}</option>)}
          </select>
        </label>
        <label className="text-sm">Assignee
          <select name="assignedUserId" className={field}>
            <option value="">Me</option>
            {users.rows.map((item) =>
              <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="text-sm">Contact organization
          <select name="organizationId" className={field}>
            <option value="">None</option>
            {organizations.rows.map((item) =>
              <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="text-sm">Contact name<input name="contactName" className={field} /></label>
        <label className="text-sm">Email<input name="email" type="email" className={field} /></label>
        <label className="text-sm">Phone<input name="phone" type="tel" className={field} /></label>
        <label className="text-sm">Registration URL
          <input name="registrationUrl" type="url" className={field} />
        </label>
        <label className="text-sm md:col-span-2">Street<input name="street" className={field} /></label>
        <label className="text-sm">Street 2<input name="street2" className={field} /></label>
        <label className="text-sm">City<input name="city" className={field} /></label>
        <label className="text-sm">State<input name="state" className={field} /></label>
        <label className="text-sm">ZIP code<input name="zipcode" className={field} /></label>
        <label className="text-sm md:col-span-2">Notes
          <textarea name="notes" rows={4} className={field} />
        </label>
        <div className="flex justify-end gap-3 md:col-span-2">
          <Link href="/prospecting" className="rounded-lg border px-4 py-2">Cancel</Link>
          <button className="rounded-lg bg-cyan-700 px-5 py-2 font-semibold text-white">
            Create lead
          </button>
        </div>
      </form>
    </div>
  );
}

