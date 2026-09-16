import { describe, expect, it } from "vitest";
import {
  canAccessBookingFinancials,
  canAccessGoogle,
  canAccessProspecting,
  canAccessTasks,
  initialRoleForEmail,
  isAllowedEmail,
  isSuperAdminRole,
  parseAdminEmails,
  resolvePersistedRole,
} from "./roles";

describe("CRM role rules", () => {
  it("normalizes configured admin emails", () => {
    expect([...parseAdminEmails(" MICHELLE@example.com, seth@example.com ")]).toEqual([
      "michelle@example.com",
      "seth@example.com",
    ]);
    expect(initialRoleForEmail("michelle@example.com", "MICHELLE@example.com")).toBe(
      "admin",
    );
  });

  it("only allows configured Google accounts on the env lists", () => {
    expect(
      isAllowedEmail(
        "seth@example.com",
        "seth@example.com",
        "michelle@example.com",
      ),
    ).toBe(true);
    expect(isAllowedEmail("stranger@example.com", "", "michelle@example.com")).toBe(
      false,
    );
  });

  it("keeps financial access admin-only at the global role layer", () => {
    expect(canAccessProspecting("prospecting_user")).toBe(true);
    expect(canAccessProspecting("member")).toBe(false);
    expect(canAccessProspecting("member", { hasOrganizationMemberships: true })).toBe(
      true,
    );
    expect(canAccessTasks("member")).toBe(false);
    expect(canAccessTasks("member", { hasOrganizationMemberships: true })).toBe(true);
    expect(canAccessTasks("prospecting_user")).toBe(true);
    expect(canAccessGoogle("member", { hasOrganizationMemberships: true })).toBe(true);
    expect(canAccessGoogle("admin")).toBe(true);
    expect(canAccessBookingFinancials("prospecting_user")).toBe(false);
    expect(canAccessBookingFinancials("member")).toBe(false);
    expect(canAccessBookingFinancials("admin")).toBe(true);
    expect(isSuperAdminRole("admin")).toBe(true);
    expect(isSuperAdminRole("member")).toBe(false);
  });

  it("promotes configured admins without downgrading org members", () => {
    expect(resolvePersistedRole("member", "prospecting_user")).toBe("member");
    expect(resolvePersistedRole("member", "admin")).toBe("admin");
    expect(resolvePersistedRole("admin", "prospecting_user")).toBe("admin");
    expect(resolvePersistedRole(undefined, "prospecting_user")).toBe(
      "prospecting_user",
    );
  });
});
