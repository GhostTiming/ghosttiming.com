import { Eye, Shield } from "lucide-react";
import {
  grantOrgAccessAction,
  removeOrgMembershipAction,
  setUserActiveAction,
  startViewAsUserAction,
  stopViewAsUserAction,
  upsertOrgMembershipAction,
} from "@/app/admin-actions";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { SyncRaceRosterPanel } from "@/components/sync-race-roster-panel";
import { getPool } from "@/db";
import { canImpersonateUser } from "@/lib/auth/access";
import { requireAdminConsole } from "@/lib/auth/server";
import type { CrmRole } from "@/lib/auth/roles";
import { TABLE_SCROLL } from "@/lib/crm/layout";

export const metadata = { title: "Admin" };

type AdminUserRow = {
  id: string;
  email: string;
  name: string;
  role: string;
  is_active: boolean;
  pending_sign_in: boolean;
  memberships: { organizationId: string; organizationName: string; orgRole: string }[];
};

const field = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";

function roleLabel(role: string) {
  if (role === "admin") return "Super admin";
  if (role === "member") return "Org member";
  return "Prospecting user";
}

export default async function AdminPage() {
  const access = await requireAdminConsole();
  const [userResult, organizations] = await Promise.all([
    getPool().query<{
      id: string;
      email: string;
      name: string;
      role: string;
      is_active: boolean;
      pending_sign_in: boolean;
      memberships: {
        organizationId: string;
        organizationName: string;
        orgRole: string;
      }[] | null;
    }>(
      `
        SELECT
          crm_user.id::text,
          crm_user.email,
          crm_user.name,
          crm_user.role::text,
          crm_user.is_active,
          crm_user.auth_provider_id LIKE 'pending:%' AS pending_sign_in,
          COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'organizationId', org.id::text,
                'organizationName', org.name,
                'orgRole', membership.org_role::text
              )
              ORDER BY org.name
            ) FILTER (WHERE membership.id IS NOT NULL),
            '[]'::jsonb
          ) AS memberships
        FROM crm.users crm_user
        LEFT JOIN crm.user_organization_memberships membership
          ON membership.user_id = crm_user.id
        LEFT JOIN crm.organizations org ON org.id = membership.organization_id
        GROUP BY crm_user.id
        ORDER BY crm_user.email
      `,
    ),
    getPool().query<{ id: string; name: string }>(
      `
        SELECT id::text, name
        FROM crm.organizations
        WHERE is_active AND archived_at IS NULL
        ORDER BY name
      `,
    ),
  ]);
  const users: AdminUserRow[] = userResult.rows.map((row) => ({
    ...row,
    memberships: row.memberships ?? [],
  }));

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wider text-cyan-700">
          Access control
        </p>
        <h1 className="flex items-center gap-2 text-3xl font-bold text-slate-950">
          <Shield aria-hidden className="size-8" />
          Admin
        </h1>
        <p className="mt-1 text-slate-600">
          Super admins can grant org-scoped CRM access. Chris should be an org
          admin; Seth an org user. They should not be added to CRM_ADMIN_EMAILS.
        </p>
        {access.viewingAs ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            <p>
              Currently viewing as{" "}
              <span className="font-semibold">{access.viewingAs.email}</span>.
              Admin stays available so you can exit.
            </p>
            <form action={stopViewAsUserAction}>
              <PendingSubmitButton
                className="rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white"
                pendingLabel="Exiting…"
              >
                Exit view
              </PendingSubmitButton>
            </form>
          </div>
        ) : null}
      </header>

      <SyncRaceRosterPanel />

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold text-slate-950">Grant access by email</h2>
        <p className="mt-1 text-sm text-slate-500">
          If the person has already signed in, this assigns the membership. If
          not, a pending user is created and they can sign in with Google using
          this email.
        </p>
        <form action={grantOrgAccessAction} className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-5">
          <label className="text-sm">Email
            <input required type="email" name="email" className={field} />
          </label>
          <label className="text-sm">Name
            <input name="name" className={field} placeholder="Optional until they sign in" />
          </label>
          <label className="text-sm">Organization
            <select required name="organizationId" className={field}>
              <option value="">Choose organization</option>
              {organizations.rows.map((org) => (
                <option key={org.id} value={org.id}>{org.name}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">Org role
            <select name="orgRole" defaultValue="org_user" className={field}>
              <option value="org_admin">Org admin</option>
              <option value="org_user">Org user</option>
            </select>
          </label>
          <div className="flex items-end">
            <PendingSubmitButton className="w-full rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white">
              Grant access
            </PendingSubmitButton>
          </div>
        </form>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className={TABLE_SCROLL}>
          <table className="w-full min-w-[1080px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Global role</th>
                <th className="px-4 py-3">Active</th>
                <th className="px-4 py-3">Assigned organizations</th>
                <th className="px-4 py-3">Grant another org</th>
                <th className="px-4 py-3">View as</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((crmUser) => {
                const assignedIds = new Set(
                  crmUser.memberships.map((item) => item.organizationId),
                );
                const availableOrgs = organizations.rows.filter(
                  (org) => !assignedIds.has(org.id),
                );
                return (
                  <tr key={crmUser.id} className="align-top">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-950">{crmUser.name}</p>
                      <p className="text-xs text-slate-500">{crmUser.email}</p>
                      {crmUser.pending_sign_in ? (
                        <p className="mt-1 text-xs font-medium text-amber-700">
                          Pending Google sign-in
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">{roleLabel(crmUser.role)}</td>
                    <td className="px-4 py-3">
                      <form action={setUserActiveAction} className="flex items-center gap-2">
                        <input type="hidden" name="userId" value={crmUser.id} />
                        <input
                          type="hidden"
                          name="isActive"
                          value={crmUser.is_active ? "false" : "true"}
                        />
                        <span>{crmUser.is_active ? "Active" : "Inactive"}</span>
                        {crmUser.id === access.user.id ? (
                          <span className="text-xs text-slate-400">You</span>
                        ) : (
                          <PendingSubmitButton
                            className="text-sm font-semibold text-cyan-700"
                            pendingLabel="Saving…"
                          >
                            {crmUser.is_active ? "Deactivate" : "Activate"}
                          </PendingSubmitButton>
                        )}
                      </form>
                    </td>
                    <td className="px-4 py-3">
                      {crmUser.memberships.length ? (
                        <ul className="space-y-2">
                          {crmUser.memberships.map((membership) => (
                            <li
                              key={membership.organizationId}
                              className="flex flex-wrap items-center gap-2"
                            >
                              <span className="font-medium">
                                {membership.organizationName}
                              </span>
                              <form action={upsertOrgMembershipAction} className="flex items-center gap-2">
                                <input type="hidden" name="userId" value={crmUser.id} />
                                <input
                                  type="hidden"
                                  name="organizationId"
                                  value={membership.organizationId}
                                />
                                <select
                                  name="orgRole"
                                  defaultValue={membership.orgRole}
                                  className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                                >
                                  <option value="org_admin">Org admin</option>
                                  <option value="org_user">Org user</option>
                                </select>
                                <PendingSubmitButton className="text-xs font-semibold text-cyan-700">
                                  Save
                                </PendingSubmitButton>
                              </form>
                              <form action={removeOrgMembershipAction}>
                                <input type="hidden" name="userId" value={crmUser.id} />
                                <input
                                  type="hidden"
                                  name="organizationId"
                                  value={membership.organizationId}
                                />
                                <PendingSubmitButton className="text-xs font-semibold text-slate-500">
                                  Remove
                                </PendingSubmitButton>
                              </form>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-slate-400">None</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {availableOrgs.length ? (
                        <form action={upsertOrgMembershipAction} className="grid gap-2">
                          <input type="hidden" name="userId" value={crmUser.id} />
                          <select required name="organizationId" className={field}>
                            <option value="">Assign organization</option>
                            {availableOrgs.map((org) => (
                              <option key={org.id} value={org.id}>{org.name}</option>
                            ))}
                          </select>
                          <select name="orgRole" defaultValue="org_user" className={field}>
                            <option value="org_admin">Org admin</option>
                            <option value="org_user">Org user</option>
                          </select>
                          <PendingSubmitButton className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white">
                            Assign
                          </PendingSubmitButton>
                        </form>
                      ) : (
                        <span className="text-xs text-slate-400">All organizations assigned</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {access.viewingAs?.id === crmUser.id ? (
                        <form action={stopViewAsUserAction}>
                          <PendingSubmitButton
                            className="text-sm font-semibold text-amber-800"
                            pendingLabel="Exiting…"
                          >
                            Exit view
                          </PendingSubmitButton>
                        </form>
                      ) : canImpersonateUser(access.user, {
                          id: crmUser.id,
                          role: crmUser.role as CrmRole,
                          isActive: crmUser.is_active,
                        }) ? (
                        <form action={startViewAsUserAction}>
                          <input type="hidden" name="userId" value={crmUser.id} />
                          <PendingSubmitButton
                            className="inline-flex items-center gap-1 text-sm font-semibold text-cyan-700"
                            pendingLabel="Starting…"
                          >
                            <Eye aria-hidden className="size-3.5" />
                            View as
                          </PendingSubmitButton>
                        </form>
                      ) : crmUser.id === access.user.id ? (
                        <span className="text-xs text-slate-400">You</span>
                      ) : crmUser.role === "admin" ? (
                        <span className="text-xs text-slate-400">Super admin</span>
                      ) : (
                        <span className="text-xs text-slate-400">Unavailable</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!users.length ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-slate-500">
                    No CRM users yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
