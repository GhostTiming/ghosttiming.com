import Link from "next/link";
import { createContactAction } from "@/app/contact-actions";
import { requireOperationsAccess } from "@/lib/auth/server";
import { listAttachableOrganizations, loadContactOrgScope } from "@/lib/crm/contact-queries";

const field = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2";

export default async function NewContactPage() {
  const access = await requireOperationsAccess();
  const scope = await loadContactOrgScope(access);
  const organizations = await listAttachableOrganizations(scope.scopeOrgIds);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <Link href="/contacts" className="text-sm font-semibold text-cyan-700">
          ← Back to contacts
        </Link>
        <h1 className="mt-2 text-3xl font-bold">Add contact</h1>
        <p className="mt-1 text-slate-600">
          Tie this person to one or more organizations, including event owners and timing companies.
        </p>
      </header>
      <form
        action={createContactAction}
        className="grid gap-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm md:grid-cols-2"
      >
        <label className="text-sm md:col-span-2">
          Display name
          <input name="displayName" className={field} placeholder="Seth Doe" />
        </label>
        <label className="text-sm">
          First name
          <input name="firstName" className={field} />
        </label>
        <label className="text-sm">
          Last name
          <input name="lastName" className={field} />
        </label>
        <label className="text-sm">
          Email
          <input name="email" type="email" className={field} />
        </label>
        <label className="text-sm">
          Phone
          <input name="phone" type="tel" className={field} />
        </label>
        <label className="text-sm md:col-span-2">
          Title
          <input name="title" className={field} />
        </label>
        <fieldset className="md:col-span-2">
          <legend className="mb-2 text-sm font-medium">Organizations</legend>
          <div className="grid max-h-64 gap-2 overflow-y-auto rounded-lg border border-slate-200 p-3 sm:grid-cols-2">
            {organizations.rows.map((organization) => (
              <label key={organization.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="organizationIds" value={organization.id} />
                {organization.name}
              </label>
            ))}
            {!organizations.rows.length ? (
              <p className="text-sm text-slate-500 sm:col-span-2">
                No organizations are available to attach.
              </p>
            ) : null}
          </div>
        </fieldset>
        <label className="text-sm md:col-span-2">
          Notes
          <textarea name="notes" rows={4} className={field} />
        </label>
        <div className="flex justify-end gap-3 md:col-span-2">
          <Link href="/contacts" className="rounded-lg border px-4 py-2">
            Cancel
          </Link>
          <button className="rounded-lg bg-cyan-700 px-5 py-2 font-semibold text-white">
            Create contact
          </button>
        </div>
      </form>
    </div>
  );
}
