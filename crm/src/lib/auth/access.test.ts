import { describe, expect, it } from "vitest";
import type { CrmUser } from "@/db/schema";
import {
  buildAccessContext,
  canImpersonateUser,
  displayAccessRole,
  effectiveAccessUserId,
  financialOrgScopeParam,
} from "./access";
import { redactBookingFinancials } from "./financials";

function user(role: CrmUser["role"], overrides: Partial<CrmUser> = {}): CrmUser {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    authProviderId: "google-sub",
    name: "Test User",
    email: "test@example.com",
    role,
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

const orgA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const orgB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const admin = user("admin", {
  id: "aaaaaaaa-1111-4111-8111-111111111111",
  email: "michele@example.com",
  name: "Michele",
});
const orgAdmin = user("member", {
  id: "bbbbbbbb-1111-4111-8111-111111111111",
  email: "chris@example.com",
  name: "Chris",
});
const orgUser = user("member", {
  id: "cccccccc-1111-4111-8111-111111111111",
  email: "seth@example.com",
  name: "Seth",
});

describe("CRM access context", () => {
  it("treats the admin role as super admin with the admin console", () => {
    const access = buildAccessContext(user("admin"), []);
    expect(access.isSuperAdmin).toBe(true);
    expect(access.canAccessAdminConsole).toBe(true);
    expect(access.canAccessOperations).toBe(true);
    expect(access.canAccessProspecting).toBe(true);
    expect(access.canAccessTasks).toBe(true);
    expect(access.canAccessGoogle).toBe(true);
    expect(access.canViewAnyFinancials).toBe(true);
    expect(access.canAccessOrganization(orgA)).toBe(true);
    expect(access.isOrgAdmin(orgA)).toBe(true);
    expect(access.canViewFinancials(orgA)).toBe(true);
    expect(access.viewingAs).toBeNull();
  });

  it("scopes org admins to assigned orgs and allows financials there", () => {
    const access = buildAccessContext(user("member"), [
      { organizationId: orgA, orgRole: "org_admin" },
    ]);
    expect(access.isSuperAdmin).toBe(false);
    expect(access.canAccessAdminConsole).toBe(false);
    expect(access.canAccessOperations).toBe(true);
    expect(access.canAccessProspecting).toBe(true);
    expect(access.canAccessTasks).toBe(true);
    expect(access.canAccessGoogle).toBe(true);
    expect(access.assignedOrgIds).toEqual([orgA]);
    expect(access.isOrgAdmin(orgA)).toBe(true);
    expect(access.canViewFinancials(orgA)).toBe(true);
    expect(access.canAccessOrganization(orgB)).toBe(false);
    expect(access.canViewFinancials(orgB)).toBe(false);
  });

  it("scopes org users to assigned orgs without financials", () => {
    const access = buildAccessContext(user("member"), [
      { organizationId: orgA, orgRole: "org_user" },
    ]);
    expect(access.canAccessAdminConsole).toBe(false);
    expect(access.canAccessOperations).toBe(true);
    expect(access.canAccessProspecting).toBe(true);
    expect(access.canAccessTasks).toBe(true);
    expect(access.canAccessGoogle).toBe(true);
    expect(access.canViewAnyFinancials).toBe(false);
    expect(access.isOrgAdmin(orgA)).toBe(false);
    expect(access.canViewFinancials(orgA)).toBe(false);
    expect(access.canAccessOrganization(orgA)).toBe(true);
  });

  it("does not give prospecting users operations, financials, or admin", () => {
    const access = buildAccessContext(user("prospecting_user"), []);
    expect(access.isSuperAdmin).toBe(false);
    expect(access.canAccessAdminConsole).toBe(false);
    expect(access.canAccessOperations).toBe(false);
    expect(access.canAccessProspecting).toBe(true);
    expect(access.canAccessTasks).toBe(true);
    expect(access.canAccessGoogle).toBe(true);
    expect(access.canViewFinancials(orgA)).toBe(false);
    expect(access.canAccessOrganization(orgA)).toBe(false);
  });

  it("redacts financial fields unless the viewer can see them", () => {
    const booking = {
      id: "booking-1",
      notes: "Keep this",
      expected_revenue: "1200.00",
      actual_revenue: "1100.00",
      amount_paid: "400.00",
      payment_due_at: "2026-05-01T00:00:00Z",
      payment_at: null as string | null,
    };
    expect(redactBookingFinancials(booking, true)).toEqual(booking);
    expect(redactBookingFinancials(booking, false)).toEqual({
      id: "booking-1",
      notes: "Keep this",
      expected_revenue: null,
      actual_revenue: null,
      amount_paid: null,
      payment_due_at: null,
      payment_at: null,
    });
  });

  it("blocks viewing as yourself, other admins, or inactive users", () => {
    expect(canImpersonateUser(admin, orgAdmin)).toBe(true);
    expect(canImpersonateUser(admin, admin)).toBe(false);
    expect(canImpersonateUser(admin, user("admin", { id: orgAdmin.id }))).toBe(false);
    expect(canImpersonateUser(admin, { ...orgAdmin, isActive: false })).toBe(false);
    expect(canImpersonateUser(orgAdmin, orgUser)).toBe(false);
  });

  it("overlays an org_admin view while keeping the real admin console", () => {
    const access = buildAccessContext(
      orgAdmin,
      [{ organizationId: orgA, orgRole: "org_admin" }],
      { actor: admin },
    );
    expect(access.user).toEqual(admin);
    expect(access.viewingAs).toEqual({
      id: orgAdmin.id,
      email: orgAdmin.email,
      name: orgAdmin.name,
    });
    expect(access.isSuperAdmin).toBe(false);
    expect(access.canAccessAdminConsole).toBe(true);
    expect(access.assignedOrgIds).toEqual([orgA]);
    expect(access.canAccessOrganization(orgA)).toBe(true);
    expect(access.canAccessOrganization(orgB)).toBe(false);
    expect(access.isOrgAdmin(orgA)).toBe(true);
    expect(access.canViewFinancials(orgA)).toBe(true);
    expect(access.canViewAnyFinancials).toBe(true);
    expect(access.canAccessProspecting).toBe(true);
    expect(access.canAccessTasks).toBe(true);
    expect(access.canAccessGoogle).toBe(true);
    expect(effectiveAccessUserId(access)).toBe(orgAdmin.id);
    expect(displayAccessRole(access)).toBe("org admin");
  });

  it("overlays an org_user view without financials and with assigned org filter", () => {
    const access = buildAccessContext(
      orgUser,
      [{ organizationId: orgA, orgRole: "org_user" }],
      { actor: admin },
    );
    expect(access.user.id).toBe(admin.id);
    expect(access.viewingAs?.email).toBe(orgUser.email);
    expect(access.isSuperAdmin).toBe(false);
    expect(access.canAccessAdminConsole).toBe(true);
    expect(access.assignedOrgIds).toEqual([orgA]);
    expect(access.canAccessOperations).toBe(true);
    expect(access.isOrgAdmin(orgA)).toBe(false);
    expect(access.canViewFinancials(orgA)).toBe(false);
    expect(access.canViewAnyFinancials).toBe(false);
    expect(access.canAccessOrganization(orgB)).toBe(false);
    expect(access.canAccessProspecting).toBe(true);
    expect(access.canAccessTasks).toBe(true);
    expect(access.canAccessGoogle).toBe(true);
    expect(effectiveAccessUserId(access)).toBe(orgUser.id);
    expect(displayAccessRole(access)).toBe("org user");
  });

  it("does not grant workspace tools to members without memberships", () => {
    const access = buildAccessContext(orgUser, []);
    expect(access.canAccessProspecting).toBe(false);
    expect(access.canAccessTasks).toBe(false);
    expect(access.canAccessGoogle).toBe(false);
    expect(access.canAccessAdminConsole).toBe(false);
    expect(access.canViewAnyFinancials).toBe(false);
  });

  it("limits financial dashboard scope to org-admin memberships", () => {
    expect(financialOrgScopeParam(buildAccessContext(admin, []))).toBeNull();
    expect(
      financialOrgScopeParam(
        buildAccessContext(orgAdmin, [{ organizationId: orgA, orgRole: "org_admin" }]),
      ),
    ).toEqual([orgA]);
    expect(
      financialOrgScopeParam(
        buildAccessContext(orgUser, [{ organizationId: orgA, orgRole: "org_user" }]),
      ),
    ).toEqual([]);
  });
});
