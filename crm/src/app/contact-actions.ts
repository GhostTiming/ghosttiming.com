"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getPool } from "@/db";
import { requireOperationsAccess } from "@/lib/auth/server";
import { appendAuditActivity } from "@/lib/crm/audit";
import {
  loadContactOrgScope,
  replacePersonOrganizations,
} from "@/lib/crm/contact-queries";
import {
  mergeVisibleOrganizationIds,
  personInContactScopeSql,
  resolvePersonDisplayName,
  resolvePrimaryOrganizationId,
  uniqueIds,
} from "@/lib/crm/contacts";

const uuid = z.string().uuid();
const optionalText = (maximum: number) =>
  z.string().trim().max(maximum).optional();

function refreshContacts(personId?: string) {
  revalidatePath("/contacts");
  revalidatePath("/organizations");
  revalidatePath("/bookings", "layout");
  if (personId) revalidatePath(`/contacts/${personId}`);
}

async function loadExistingOrganizationIds(personId: string) {
  const result = await getPool().query<{ organization_id: string }>(
    `
      SELECT DISTINCT organization_id::text
      FROM (
        SELECT organization_id FROM crm.person_organizations
        WHERE person_id = $1::uuid
        UNION
        SELECT organization_id FROM crm.people
        WHERE id = $1::uuid AND organization_id IS NOT NULL
      ) ties
    `,
    [personId],
  );
  return result.rows.map((row) => row.organization_id);
}

async function requireVisibleContact(personId: string) {
  const access = await requireOperationsAccess();
  const scope = await loadContactOrgScope(access);
  const person = await getPool().query<{ id: string }>(
    `
      SELECT person.id::text
      FROM crm.people person
      WHERE person.id = $3::uuid
        AND ${personInContactScopeSql(1, 2)}
    `,
    [scope.scopeOrgIds, scope.assignedOrgIds, personId],
  );
  if (!person.rows[0]) {
    throw new Error("Contact not found.");
  }
  return { access, scope };
}

function parseContactFields(formData: FormData) {
  const firstName = optionalText(150).parse(formData.get("firstName") || undefined);
  const lastName = optionalText(150).parse(formData.get("lastName") || undefined);
  const displayName = resolvePersonDisplayName({
    displayName: optionalText(300).parse(formData.get("displayName") || undefined),
    firstName,
    lastName,
  });
  if (!displayName) {
    throw new Error("Enter a name for this contact.");
  }
  return {
    displayName,
    firstName,
    lastName,
    title: optionalText(200).parse(formData.get("title") || undefined),
    email: z.string().trim().email().max(300).optional()
      .parse(formData.get("email") || undefined),
    phone: optionalText(100).parse(formData.get("phone") || undefined),
    notes: optionalText(10_000).parse(formData.get("notes") || undefined),
    isActive: formData.has("isActive")
      ? formData.getAll("isActive").includes("true")
      : true,
    organizationIds: uniqueIds(
      formData.getAll("organizationIds").flatMap((value) => {
        const parsed = uuid.safeParse(String(value));
        return parsed.success ? [parsed.data] : [];
      }),
    ),
  };
}

export async function createContactAction(formData: FormData) {
  const access = await requireOperationsAccess();
  const scope = await loadContactOrgScope(access);
  const fields = parseContactFields(formData);
  const organizationIds = mergeVisibleOrganizationIds({
    existingIds: [],
    selectedVisibleIds: fields.organizationIds,
    visibleOrgIds: scope.scopeOrgIds,
  });
  if (!access.isSuperAdmin && !organizationIds.length) {
    throw new Error("Choose at least one organization this contact belongs to.");
  }
  const client = await getPool().connect();
  let personId: string;
  try {
    await client.query("BEGIN");
    const person = await client.query<{ id: string }>(
      `
        INSERT INTO crm.people
          (organization_id, display_name, first_name, last_name, title, email, phone, notes, is_active)
        VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id::text
      `,
      [
        resolvePrimaryOrganizationId(null, organizationIds),
        fields.displayName,
        fields.firstName ?? null,
        fields.lastName ?? null,
        fields.title ?? null,
        fields.email ?? null,
        fields.phone ?? null,
        fields.notes ?? null,
        fields.isActive,
      ],
    );
    personId = person.rows[0].id;
    await replacePersonOrganizations(client, personId, organizationIds);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  refreshContacts(personId);
  redirect(`/contacts/${personId}`);
}

export async function updateContactAction(formData: FormData) {
  const personId = uuid.parse(formData.get("personId"));
  const { access, scope } = await requireVisibleContact(personId);
  const fields = parseContactFields(formData);
  const existingIds = await loadExistingOrganizationIds(personId);
  const organizationIds = mergeVisibleOrganizationIds({
    existingIds,
    selectedVisibleIds: fields.organizationIds,
    visibleOrgIds: scope.scopeOrgIds,
  });
  if (!access.isSuperAdmin && !organizationIds.length) {
    throw new Error("Choose at least one organization this contact belongs to.");
  }
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const current = await client.query<{ organization_id: string | null }>(
      `SELECT organization_id::text FROM crm.people WHERE id = $1::uuid FOR UPDATE`,
      [personId],
    );
    if (!current.rows[0]) throw new Error("Contact not found.");
    const primaryId = resolvePrimaryOrganizationId(
      current.rows[0].organization_id,
      organizationIds,
    );
    const changed = await client.query(
      `
        UPDATE crm.people
        SET display_name = $2, first_name = $3, last_name = $4, title = $5,
          email = $6, phone = $7, notes = $8, organization_id = $9::uuid,
          is_active = $10, updated_at = now()
        WHERE id = $1::uuid
        RETURNING id
      `,
      [
        personId,
        fields.displayName,
        fields.firstName ?? null,
        fields.lastName ?? null,
        fields.title ?? null,
        fields.email ?? null,
        fields.phone ?? null,
        fields.notes ?? null,
        primaryId,
        fields.isActive,
      ],
    );
    if (!changed.rowCount) throw new Error("Contact not found.");
    await replacePersonOrganizations(client, personId, organizationIds);
    const auditOrgId = primaryId ?? organizationIds[0];
    if (auditOrgId) {
      await appendAuditActivity(
        client,
        { organizationId: auditOrgId },
        access.user,
        `Contact updated: ${fields.displayName}`,
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  refreshContacts(personId);
  redirect(`/contacts/${personId}`);
}

export async function setContactArchivedAction(formData: FormData) {
  const personId = uuid.parse(formData.get("personId"));
  const restore = formData.get("operation") === "restore";
  const { access } = await requireVisibleContact(personId);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const person = await client.query<{
      display_name: string | null;
      organization_id: string | null;
    }>(
      `
        UPDATE crm.people
        SET is_active = $2,
          archived_at = CASE WHEN $2 THEN NULL ELSE now() END,
          archived_by_user_id = CASE WHEN $2 THEN NULL ELSE $3::uuid END,
          updated_at = now()
        WHERE id = $1::uuid
        RETURNING display_name, organization_id::text
      `,
      [personId, restore, access.user.id],
    );
    const row = person.rows[0];
    if (!row) throw new Error("Contact not found.");
    if (row.organization_id) {
      await appendAuditActivity(
        client,
        { organizationId: row.organization_id },
        access.user,
        restore
          ? `Contact restored: ${row.display_name}`
          : `Contact archived: ${row.display_name}`,
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  refreshContacts(personId);
}

export async function setContactActiveAction(formData: FormData) {
  const personId = uuid.parse(formData.get("personId"));
  const isActive = formData.get("isActive") !== "false";
  const { access } = await requireVisibleContact(personId);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const person = await client.query<{
      display_name: string | null;
      organization_id: string | null;
    }>(
      `
        UPDATE crm.people
        SET is_active = $2, updated_at = now()
        WHERE id = $1::uuid AND archived_at IS NULL
        RETURNING display_name, organization_id::text
      `,
      [personId, isActive],
    );
    const row = person.rows[0];
    if (!row) throw new Error("Contact not found or archived.");
    if (row.organization_id) {
      await appendAuditActivity(
        client,
        { organizationId: row.organization_id },
        access.user,
        isActive
          ? `Contact marked active: ${row.display_name}`
          : `Contact marked inactive: ${row.display_name}`,
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  refreshContacts(personId);
}
