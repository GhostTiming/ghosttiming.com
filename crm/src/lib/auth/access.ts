import type { CrmUser } from "@/db/schema";
import {
  canAccessGoogle,
  canAccessProspecting,
  canAccessTasks,
  isSuperAdminRole,
  type CrmRole,
} from "./roles";

export const VIEW_AS_COOKIE_NAME = "crm_view_as_user_id";

export type MembershipOrgRole = "org_admin" | "org_user";

export type OrganizationMembership = {
  organizationId: string;
  orgRole: MembershipOrgRole;
};

export type ViewAsUser = {
  id: string;
  email: string;
  name: string;
};

export type AccessContext = {
  user: CrmUser;
  viewingAs: ViewAsUser | null;
  isSuperAdmin: boolean;
  assignedOrgIds: string[];
  memberships: OrganizationMembership[];
  canAccessAdminConsole: boolean;
  canAccessOperations: boolean;
  canAccessProspecting: boolean;
  canAccessTasks: boolean;
  canAccessGoogle: boolean;
  canViewAnyFinancials: boolean;
  isOrgAdmin: (orgId: string) => boolean;
  canViewFinancials: (orgId: string) => boolean;
  canAccessOrganization: (orgId: string) => boolean;
};

export type BuildAccessContextOptions = {
  actor?: CrmUser;
};

export function canImpersonateUser(
  actor: Pick<CrmUser, "id" | "role">,
  target: Pick<CrmUser, "id" | "role" | "isActive">,
): boolean {
  if (actor.id === target.id) return false;
  if (!isSuperAdminRole(actor.role)) return false;
  if (isSuperAdminRole(target.role as CrmRole)) return false;
  if (!target.isActive) return false;
  return true;
}

export function buildAccessContext(
  user: CrmUser,
  memberships: OrganizationMembership[],
  options: BuildAccessContextOptions = {},
): AccessContext {
  const actor = options.actor ?? user;
  const viewingAs =
    actor.id !== user.id
      ? { id: user.id, email: user.email, name: user.name }
      : null;
  const isSuperAdmin = isSuperAdminRole(user.role);
  const assignedOrgIds = [...new Set(memberships.map((item) => item.organizationId))];
  const membershipByOrg = new Map(
    memberships.map((item) => [item.organizationId, item.orgRole]),
  );

  const isOrgAdmin = (orgId: string) => {
    if (isSuperAdmin) return true;
    return membershipByOrg.get(orgId) === "org_admin";
  };

  const canAccessOrganization = (orgId: string) => {
    if (isSuperAdmin) return true;
    return membershipByOrg.has(orgId);
  };

  const canViewFinancials = (orgId: string) => isOrgAdmin(orgId);
  const membershipOptions = {
    hasOrganizationMemberships: assignedOrgIds.length > 0,
  };

  return {
    user: actor,
    viewingAs,
    isSuperAdmin,
    assignedOrgIds,
    memberships,
    canAccessAdminConsole: isSuperAdminRole(actor.role),
    canAccessOperations: isSuperAdmin || assignedOrgIds.length > 0,
    canAccessProspecting: canAccessProspecting(user.role, membershipOptions),
    canAccessTasks: canAccessTasks(user.role, membershipOptions),
    canAccessGoogle: canAccessGoogle(user.role, membershipOptions),
    canViewAnyFinancials:
      isSuperAdmin || memberships.some((item) => item.orgRole === "org_admin"),
    isOrgAdmin,
    canViewFinancials,
    canAccessOrganization,
  };
}

export function effectiveAccessUserId(access: AccessContext): string {
  return access.viewingAs?.id ?? access.user.id;
}

export function displayAccessRole(access: AccessContext): string {
  if (access.isSuperAdmin) return "super admin";
  if (access.memberships.some((item) => item.orgRole === "org_admin")) {
    return "org admin";
  }
  if (access.memberships.length) return "org user";
  if (access.canAccessProspecting) return "prospecting user";
  if (access.viewingAs) return "member";
  return access.user.role.replaceAll("_", " ");
}

export function bookingOrgScopeParam(access: AccessContext): string[] | null {
  return access.isSuperAdmin ? null : access.assignedOrgIds;
}
