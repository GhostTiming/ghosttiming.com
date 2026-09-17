import "server-only";

import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getDb, getPool } from "@/db";
import { users, type CrmUser } from "@/db/schema";
import { displayUserName, splitFullName } from "@/lib/crm/user-profile";
import {
  buildAccessContext,
  canImpersonateUser,
  VIEW_AS_COOKIE_NAME,
  type AccessContext,
  type OrganizationMembership,
} from "./access";
import { auth } from "./neon";
import {
  canAccessBookingFinancials,
  initialRoleForEmail,
  isAllowedEmail,
  isSuperAdminRole,
  resolvePersistedRole,
  type CrmRole,
} from "./roles";

export { auth };
export { buildAccessContext } from "./access";

export async function requireCrmUser(): Promise<CrmUser> {
  const { data: session, error } = await auth.getSession();
  if (error) {
    throw new Error(`Unable to verify your session: ${error.message}`);
  }
  if (!session?.user) {
    redirect("/auth/sign-in");
  }

  const email = session.user.email.toLowerCase();
  const authProviderId = session.user.id;
  const name = session.user.name || email;
  const db = getDb();
  const [existingByProvider, existingByEmail] = await Promise.all([
    db.query.users.findFirst({
      where: eq(users.authProviderId, authProviderId),
    }),
    db.query.users.findFirst({
      where: eq(users.email, email),
    }),
  ]);
  const existing = existingByProvider ?? existingByEmail;
  if (!existing && !isAllowedEmail(email)) {
    throw new Error(
      "This Google account is not on the CRM access list. Ask an administrator to add it.",
    );
  }

  const configuredRole = initialRoleForEmail(email);
  const role = resolvePersistedRole(existing?.role as CrmRole | undefined, configuredRole);
  const googleName = splitFullName(name);
  const firstName = existing?.firstName?.trim() || googleName.firstName;
  const lastName = existing?.lastName?.trim() || googleName.lastName;
  const displayName = displayUserName({
    firstName,
    lastName,
    fallback: existing?.name || name,
  });

  const profile = {
    authProviderId,
    email,
    name: displayName,
    firstName,
    lastName,
    role,
    updatedAt: new Date(),
  };

  if (
    existing &&
    existing.authProviderId === authProviderId &&
    existing.email === email &&
    existing.name === displayName &&
    (existing.firstName ?? null) === (firstName ?? null) &&
    (existing.lastName ?? null) === (lastName ?? null) &&
    existing.role === role
  ) {
    if (!existing.isActive) {
      throw new Error("This CRM account is inactive.");
    }
    return existing;
  }

  const [crmUser] = existing
    ? await db
        .update(users)
        .set(profile)
        .where(eq(users.id, existing.id))
        .returning()
    : await db
        .insert(users)
        .values(profile)
        .onConflictDoUpdate({
          target: users.authProviderId,
          set: profile,
        })
        .returning();

  if (!crmUser.isActive) {
    throw new Error("This CRM account is inactive.");
  }
  return crmUser;
}

const viewAsUserIdSchema = z.string().uuid();

export const viewAsCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 12,
  secure: process.env.NODE_ENV === "production",
};

async function readViewAsUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  const parsed = viewAsUserIdSchema.safeParse(
    cookieStore.get(VIEW_AS_COOKIE_NAME)?.value,
  );
  return parsed.success ? parsed.data : null;
}

async function loadOrganizationMemberships(userId: string) {
  const memberships = await getPool().query<OrganizationMembership>(
    `
      SELECT organization_id::text AS "organizationId",
             org_role::text AS "orgRole"
      FROM crm.user_organization_memberships
      WHERE user_id = $1::uuid
    `,
    [userId],
  );
  return memberships.rows;
}

export async function requireProspectingAccess() {
  const access = await getAccessContext();
  if (!access.canAccessProspecting) notFound();
  return access;
}

export async function requireProspectingUser() {
  const access = await requireProspectingAccess();
  return access.user;
}

export async function requireTasksAccess() {
  const access = await getAccessContext();
  if (!access.canAccessTasks) notFound();
  return access;
}

export async function requireAdmin() {
  const user = await requireCrmUser();
  if (!canAccessBookingFinancials(user.role)) {
    throw new Error("Admin access is required.");
  }
  return user;
}

export async function getAccessContext(): Promise<AccessContext> {
  const actor = await requireCrmUser();
  const viewAsUserId = isSuperAdminRole(actor.role) ? await readViewAsUserId() : null;
  if (!viewAsUserId || viewAsUserId === actor.id) {
    return buildAccessContext(actor, await loadOrganizationMemberships(actor.id));
  }

  const target = await getDb().query.users.findFirst({
    where: eq(users.id, viewAsUserId),
  });
  if (!target || !canImpersonateUser(actor, target)) {
    return buildAccessContext(actor, await loadOrganizationMemberships(actor.id));
  }

  return buildAccessContext(
    target,
    await loadOrganizationMemberships(target.id),
    { actor },
  );
}

export async function setViewAsCookie(userId: string) {
  const cookieStore = await cookies();
  cookieStore.set(VIEW_AS_COOKIE_NAME, userId, viewAsCookieOptions);
}

export async function clearViewAsCookie() {
  const cookieStore = await cookies();
  cookieStore.delete({ name: VIEW_AS_COOKIE_NAME, path: "/" });
}

export async function requireAdminConsole() {
  const access = await getAccessContext();
  if (!access.canAccessAdminConsole) notFound();
  return access;
}

export async function requireOperationsAccess() {
  const access = await getAccessContext();
  if (!access.canAccessOperations) notFound();
  return access;
}

export async function requireContactsAccess() {
  const access = await getAccessContext();
  if (!access.canAccessOperations && !access.canAccessProspecting) notFound();
  return access;
}

export async function requireBookingOperator(bookingId: string) {
  const access = await requireOperationsAccess();
  const booking = await getPool().query<{
    id: string;
    direct_client_organization_id: string;
  }>(
    `
      SELECT id::text, direct_client_organization_id::text
      FROM crm.bookings
      WHERE id = $1::uuid
    `,
    [bookingId],
  );
  const row = booking.rows[0];
  if (!row) throw new Error("Booking not found.");
  if (!access.canAccessOrganization(row.direct_client_organization_id)) {
    notFound();
  }
  return {
    access,
    user: access.user,
    organizationId: row.direct_client_organization_id,
  };
}
