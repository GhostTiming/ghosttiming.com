import Link from "next/link";
import { createOrganizationAction } from "@/app/organization-actions";
import { requireAdmin } from "@/lib/auth/server";

const field = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2";

export default async function NewOrganizationPage() {
  await requireAdmin();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <Link href="/organizations" className="text-sm font-semibold text-cyan-700">
          ← Back to organizations
        </Link>
        <h1 className="mt-2 text-3xl font-bold">Add organization</h1>
      </header>
      <form action={createOrganizationAction}
        className="grid gap-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm md:grid-cols-2">
        <label className="text-sm md:col-span-2">Name
          <input required name="name" className={field} />
        </label>
        <label className="text-sm">Website<input name="website" type="url" className={field} /></label>
        <label className="text-sm">Email<input name="email" type="email" className={field} /></label>
        <label className="text-sm">Phone<input name="phone" type="tel" className={field} /></label>
        <label className="text-sm">Street<input name="street" className={field} /></label>
        <label className="text-sm">Street 2<input name="street2" className={field} /></label>
        <label className="text-sm">City<input name="city" className={field} /></label>
        <label className="text-sm">State<input name="state" className={field} /></label>
        <label className="text-sm">ZIP code<input name="zipcode" className={field} /></label>
        <fieldset className="md:col-span-2">
          <legend className="mb-2 text-sm">Roles</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {[["direct_client", "Direct client"], ["event_owner", "Event owner"],
              ["timing_company", "Timing company"], ["other", "Other"]].map(
              ([value, label], index) => (
                <label key={value} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="roles" value={value}
                    defaultChecked={index === 0} /> {label}
                </label>
              ))}
          </div>
        </fieldset>
        <label className="text-sm md:col-span-2">Notes
          <textarea name="notes" rows={4} className={field} />
        </label>
        <div className="flex justify-end gap-3 md:col-span-2">
          <Link href="/organizations" className="rounded-lg border px-4 py-2">Cancel</Link>
          <button className="rounded-lg bg-cyan-700 px-5 py-2 font-semibold text-white">
            Create organization
          </button>
        </div>
      </form>
    </div>
  );
}

