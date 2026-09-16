export type CrmRole = "admin" | "prospecting_user" | "member";

export function parseAdminEmails(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function initialRoleForEmail(
  email: string,
  configuredAdminEmails = process.env.CRM_ADMIN_EMAILS,
): CrmRole {
  return parseAdminEmails(configuredAdminEmails).has(email.trim().toLowerCase())
    ? "admin"
    : "prospecting_user";
}

// CRM_ADMIN_EMAILS still mint super admins (`admin` role). CRM_ALLOWED_EMAILS
// still allow first-time Google sign-in. Org members (Chris/Seth) do not need
// to be admins: an active crm.users row is enough to sign in even if they are
// not on CRM_ALLOWED_EMAILS.
export function isAllowedEmail(
  email: string,
  configuredAllowedEmails = process.env.CRM_ALLOWED_EMAILS,
  configuredAdminEmails = process.env.CRM_ADMIN_EMAILS,
): boolean {
  const normalized = email.trim().toLowerCase();
  return (
    parseAdminEmails(configuredAdminEmails).has(normalized) ||
    parseAdminEmails(configuredAllowedEmails).has(normalized)
  );
}

export type RoleAccessOptions = {
  hasOrganizationMemberships?: boolean;
};

export function isSuperAdminRole(role: CrmRole): boolean {
  return role === "admin";
}

function hasOrgWorkspaceAccess(role: CrmRole, options?: RoleAccessOptions) {
  return role === "member" && Boolean(options?.hasOrganizationMemberships);
}

export function canAccessProspecting(
  role: CrmRole,
  options?: RoleAccessOptions,
): boolean {
  return (
    role === "admin" ||
    role === "prospecting_user" ||
    hasOrgWorkspaceAccess(role, options)
  );
}

export function canAccessTasks(role: CrmRole, options?: RoleAccessOptions): boolean {
  return canAccessProspecting(role, options);
}

export function canAccessGoogle(role: CrmRole, options?: RoleAccessOptions): boolean {
  return canAccessProspecting(role, options);
}

export function canAccessBookingFinancials(role: CrmRole): boolean {
  return role === "admin";
}

export function resolvePersistedRole(
  existingRole: CrmRole | undefined,
  configuredRole: CrmRole,
): CrmRole {
  if (configuredRole === "admin" || existingRole === "admin") return "admin";
  if (existingRole) return existingRole;
  return configuredRole;
}
