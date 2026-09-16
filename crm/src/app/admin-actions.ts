"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getPool } from "@/db";
import { canImpersonateUser } from "@/lib/auth/access";
import { isSuperAdminRole, type CrmRole } from "@/lib/auth/roles";
import {
  clearViewAsCookie,
  requireAdminConsole,
  setViewAsCookie,
} from "@/lib/auth/server";

const uuid = z.string().uuid();
const emailSchema = z.string().trim().email().transform((value) => value.toLowerCase());
const orgRoleSchema = z.enum(["org_admin", "org_user"]);
const PENDING_AUTH_PREFIX = "pending:";

function refreshAdmin() {
  revalidatePath("/admin");
}

function assertNotSelfLock(actorId: string, targetId: string) {
  if (actorId === targetId) {
    throw new Error("You cannot deactivate or demote your own super-admin account.");
  }
}

async function ensureMemberRole(userId: string, currentRole: string) {
  if (currentRole === "admin") return;
  await getPool().query(
    `
      UPDATE crm.users
      SET role = 'member', updated_at = now()
      WHERE id = $1::uuid AND role <> 'admin'
    `,
    [userId],
  );
}

export async function grantOrgAccessAction(formData: FormData) {
  await requireAdminConsole();
  const input = z
    .object({
      email: emailSchema,
      name: z.string().trim().max(200).optional(),
      organizationId: uuid,
      orgRole: orgRoleSchema,
    })
    .parse({
      email: formData.get("email"),
      name: formData.get("name") || undefined,
      organizationId: formData.get("organizationId"),
      orgRole: formData.get("orgRole"),
    });

  const existing = await getPool().query<{
    id: string;
    role: string;
  }>(
    `
      SELECT id::text, role::text
      FROM crm.users
      WHERE lower(email) = $1
      LIMIT 1
    `,
    [input.email],
  );

  let userId = existing.rows[0]?.id;
  if (!userId) {
    const created = await getPool().query<{ id: string }>(
      `
        INSERT INTO crm.users (auth_provider_id, name, email, role, is_active)
        VALUES ($1, $2, $3, 'member', true)
        RETURNING id::text
      `,
      [
        `${PENDING_AUTH_PREFIX}${input.email}`,
        input.name || input.email,
        input.email,
      ],
    );
    userId = created.rows[0].id;
  } else {
    await ensureMemberRole(userId, existing.rows[0].role);
  }

  await getPool().query(
    `
      INSERT INTO crm.user_organization_memberships
        (user_id, organization_id, org_role)
      VALUES ($1::uuid, $2::uuid, $3::crm.membership_org_role)
      ON CONFLICT (user_id, organization_id)
      DO UPDATE SET org_role = EXCLUDED.org_role, updated_at = now()
    `,
    [userId, input.organizationId, input.orgRole],
  );
  refreshAdmin();
}

export async function upsertOrgMembershipAction(formData: FormData) {
  await requireAdminConsole();
  const input = z
    .object({
      userId: uuid,
      organizationId: uuid,
      orgRole: orgRoleSchema,
    })
    .parse({
      userId: formData.get("userId"),
      organizationId: formData.get("organizationId"),
      orgRole: formData.get("orgRole"),
    });

  const target = await getPool().query<{ role: string }>(
    `SELECT role::text FROM crm.users WHERE id = $1::uuid`,
    [input.userId],
  );
  if (!target.rows[0]) throw new Error("User not found.");
  await ensureMemberRole(input.userId, target.rows[0].role);
  await getPool().query(
    `
      INSERT INTO crm.user_organization_memberships
        (user_id, organization_id, org_role)
      VALUES ($1::uuid, $2::uuid, $3::crm.membership_org_role)
      ON CONFLICT (user_id, organization_id)
      DO UPDATE SET org_role = EXCLUDED.org_role, updated_at = now()
    `,
    [input.userId, input.organizationId, input.orgRole],
  );
  refreshAdmin();
}

export async function removeOrgMembershipAction(formData: FormData) {
  await requireAdminConsole();
  const input = z
    .object({
      userId: uuid,
      organizationId: uuid,
    })
    .parse({
      userId: formData.get("userId"),
      organizationId: formData.get("organizationId"),
    });
  await getPool().query(
    `
      DELETE FROM crm.user_organization_memberships
      WHERE user_id = $1::uuid AND organization_id = $2::uuid
    `,
    [input.userId, input.organizationId],
  );
  refreshAdmin();
}

export async function setUserActiveAction(formData: FormData) {
  const actor = await requireAdminConsole();
  const input = z
    .object({
      userId: uuid,
      isActive: z.enum(["true", "false"]),
    })
    .parse({
      userId: formData.get("userId"),
      isActive: formData.get("isActive"),
    });
  if (input.isActive === "false") {
    assertNotSelfLock(actor.user.id, input.userId);
  }
  const updated = await getPool().query(
    `
      UPDATE crm.users
      SET is_active = $2, updated_at = now()
      WHERE id = $1::uuid
      RETURNING id
    `,
    [input.userId, input.isActive === "true"],
  );
  if (!updated.rowCount) throw new Error("User not found.");
  refreshAdmin();
}

function refreshViewAs() {
  revalidatePath("/", "layout");
  revalidatePath("/admin");
  revalidatePath("/dashboard");
  revalidatePath("/bookings");
}

export async function startViewAsUserAction(formData: FormData) {
  const actor = await requireAdminConsole();
  if (!isSuperAdminRole(actor.user.role)) {
    throw new Error("Only a super admin can view the CRM as another user.");
  }
  const userId = uuid.parse(formData.get("userId"));
  const target = await getPool().query<{
    id: string;
    role: string;
    is_active: boolean;
  }>(
    `
      SELECT id::text, role::text, is_active
      FROM crm.users
      WHERE id = $1::uuid
    `,
    [userId],
  );
  const row = target.rows[0];
  if (!row) throw new Error("User not found.");
  if (row.id === actor.user.id) {
    throw new Error("You are already signed in as this user.");
  }
  if (isSuperAdminRole(row.role as CrmRole)) {
    throw new Error("You cannot view the CRM as another super admin.");
  }
  if (!canImpersonateUser(actor.user, {
    id: row.id,
    role: row.role as CrmRole,
    isActive: row.is_active,
  })) {
    throw new Error("You cannot view the CRM as this user.");
  }
  await setViewAsCookie(row.id);
  refreshViewAs();
  redirect("/dashboard");
}

export async function stopViewAsUserAction() {
  const actor = await requireAdminConsole();
  if (!isSuperAdminRole(actor.user.role)) {
    throw new Error("Only a super admin can exit view-as mode.");
  }
  await clearViewAsCookie();
  refreshViewAs();
  redirect("/admin");
}
