"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getPool } from "@/db";
import { requireAdmin } from "@/lib/auth/server";
import { appendAuditActivity } from "@/lib/crm/audit";
import { addPersonOrganization } from "@/lib/crm/contact-queries";

const uuid = z.string().uuid();
const roles = [
  "direct_client",
  "event_owner",
  "timing_company",
  "other",
] as const;

export async function createOrganizationAction(formData: FormData) {
  await requireAdmin();
  const input = z
    .object({
      name: z.string().trim().min(1).max(300),
      website: z.string().trim().max(2_000).optional(),
      email: z.string().trim().email().optional(),
      phone: z.string().trim().max(100).optional(),
      street: z.string().trim().max(500).optional(),
      street2: z.string().trim().max(500).optional(),
      city: z.string().trim().max(200).optional(),
      state: z.string().trim().max(100).optional(),
      zipcode: z.string().trim().max(30).optional(),
      notes: z.string().trim().max(20_000).optional(),
      roles: z.array(z.enum(roles)).min(1),
    })
    .parse({
      name: formData.get("name"),
      website: formData.get("website") || undefined,
      email: formData.get("email") || undefined,
      phone: formData.get("phone") || undefined,
      street: formData.get("street") || undefined,
      street2: formData.get("street2") || undefined,
      city: formData.get("city") || undefined,
      state: formData.get("state") || undefined,
      zipcode: formData.get("zipcode") || undefined,
      notes: formData.get("notes") || undefined,
      roles: formData.getAll("roles"),
    });
  const client = await getPool().connect();
  let organizationId: string;
  try {
    await client.query("BEGIN");
    const organization = await client.query<{ id: string }>(
      `
        INSERT INTO crm.organizations
          (name, website, email, phone, street, street2, city, state, zipcode, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id::text
      `,
      [input.name, input.website, input.email, input.phone, input.street,
        input.street2, input.city, input.state, input.zipcode, input.notes],
    );
    organizationId = organization.rows[0].id;
    await client.query(
      `
        INSERT INTO crm.organization_roles (organization_id, role)
        SELECT $1::uuid, unnest($2::crm.organization_role[])
      `,
      [organizationId, input.roles],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  redirect(`/organizations/${organizationId}`);
}

export async function addOrganizationPersonAction(formData: FormData) {
  await requireAdmin();
  const input = z
    .object({
      organizationId: uuid,
      displayName: z.string().trim().min(1).max(300),
      title: z.string().trim().max(200).optional(),
      email: z.string().trim().email().optional(),
      phone: z.string().trim().max(100).optional(),
      notes: z.string().trim().max(10_000).optional(),
    })
    .parse({
      organizationId: formData.get("organizationId"),
      displayName: formData.get("displayName"),
      title: formData.get("title") || undefined,
      email: formData.get("email") || undefined,
      phone: formData.get("phone") || undefined,
      notes: formData.get("notes") || undefined,
    });
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const person = await client.query<{ id: string }>(
      `
        INSERT INTO crm.people
          (organization_id, display_name, title, email, phone, notes)
        VALUES ($1::uuid, $2, $3, $4, $5, $6)
        RETURNING id::text
      `,
      [
        input.organizationId,
        input.displayName,
        input.title,
        input.email,
        input.phone,
        input.notes,
      ],
    );
    await addPersonOrganization(client, person.rows[0].id, input.organizationId);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  revalidatePath(`/organizations/${input.organizationId}`);
  revalidatePath("/contacts");
}

export async function addOrganizationRelationshipAction(formData: FormData) {
  await requireAdmin();
  const sourceOrganizationId = uuid.parse(formData.get("sourceOrganizationId"));
  const targetOrganizationId = uuid.parse(formData.get("targetOrganizationId"));
  if (sourceOrganizationId === targetOrganizationId) {
    throw new Error("An organization cannot be its own client.");
  }
  await getPool().query(
    `
      INSERT INTO crm.organization_relationships
        (source_organization_id, target_organization_id, relationship_type)
      VALUES ($1::uuid, $2::uuid, 'client_of')
      ON CONFLICT (source_organization_id, target_organization_id, relationship_type)
      DO NOTHING
    `,
    [sourceOrganizationId, targetOrganizationId],
  );
  revalidatePath(`/organizations/${sourceOrganizationId}`);
  revalidatePath(`/organizations/${targetOrganizationId}`);
}

export async function updateOrganizationAction(formData: FormData) {
  const user = await requireAdmin();
  const input = z.object({
    organizationId: uuid,
    name: z.string().trim().min(1).max(300),
    website: z.string().trim().url().max(2_000).optional(),
    email: z.string().trim().email().optional(),
    phone: z.string().trim().max(100).optional(),
    street: z.string().trim().max(500).optional(),
    street2: z.string().trim().max(500).optional(),
    city: z.string().trim().max(200).optional(),
    state: z.string().trim().max(100).optional(),
    zipcode: z.string().trim().max(30).optional(),
    notes: z.string().trim().max(20_000).optional(),
    roles: z.array(z.enum(roles)).min(1),
  }).parse({
    organizationId: formData.get("organizationId"),
    name: formData.get("name"),
    website: formData.get("website") || undefined,
    email: formData.get("email") || undefined,
    phone: formData.get("phone") || undefined,
    street: formData.get("street") || undefined,
    street2: formData.get("street2") || undefined,
    city: formData.get("city") || undefined,
    state: formData.get("state") || undefined,
    zipcode: formData.get("zipcode") || undefined,
    notes: formData.get("notes") || undefined,
    roles: formData.getAll("roles"),
  });
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `
        UPDATE crm.organizations SET name = $2, website = $3, email = $4,
          phone = $5, street = $6, street2 = $7, city = $8, state = $9,
          zipcode = $10, notes = $11, updated_at = now()
        WHERE id = $1::uuid
        RETURNING id
      `,
      [input.organizationId, input.name, input.website ?? null,
        input.email ?? null, input.phone ?? null, input.street ?? null,
        input.street2 ?? null, input.city ?? null, input.state ?? null,
        input.zipcode ?? null, input.notes ?? null],
    );
    if (!result.rowCount) throw new Error("Organization not found.");
    await client.query(
      `DELETE FROM crm.organization_roles WHERE organization_id = $1::uuid`,
      [input.organizationId],
    );
    await client.query(
      `INSERT INTO crm.organization_roles (organization_id, role)
       SELECT $1::uuid, unnest($2::crm.organization_role[])`,
      [input.organizationId, input.roles],
    );
    await appendAuditActivity(client, { organizationId: input.organizationId },
      user, "Organization details updated");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  revalidatePath(`/organizations/${input.organizationId}`);
  revalidatePath("/organizations");
  redirect(`/organizations/${input.organizationId}`);
}

export async function updateOrganizationPersonAction(formData: FormData) {
  const user = await requireAdmin();
  const input = z.object({
    organizationId: uuid,
    personId: uuid,
    displayName: z.string().trim().min(1).max(300),
    firstName: z.string().trim().max(150).optional(),
    lastName: z.string().trim().max(150).optional(),
    title: z.string().trim().max(200).optional(),
    contactType: z.string().trim().max(100).optional(),
    email: z.string().trim().email().optional(),
    phone: z.string().trim().max(100).optional(),
    street: z.string().trim().max(500).optional(),
    city: z.string().trim().max(200).optional(),
    state: z.string().trim().max(100).optional(),
    zipcode: z.string().trim().max(30).optional(),
    notes: z.string().trim().max(10_000).optional(),
    doNotContact: z.boolean(),
    emailOptOut: z.boolean(),
  }).parse({
    organizationId: formData.get("organizationId"),
    personId: formData.get("personId"),
    displayName: formData.get("displayName"),
    firstName: formData.get("firstName") || undefined,
    lastName: formData.get("lastName") || undefined,
    title: formData.get("title") || undefined,
    contactType: formData.get("contactType") || undefined,
    email: formData.get("email") || undefined,
    phone: formData.get("phone") || undefined,
    street: formData.get("street") || undefined,
    city: formData.get("city") || undefined,
    state: formData.get("state") || undefined,
    zipcode: formData.get("zipcode") || undefined,
    notes: formData.get("notes") || undefined,
    doNotContact: formData.get("doNotContact") === "on",
    emailOptOut: formData.get("emailOptOut") === "on",
  });
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const changed = await client.query(
      `
        UPDATE crm.people SET display_name = $3, first_name = $4,
          last_name = $5, title = $6, contact_type = $7, email = $8,
          phone = $9, street = $10, city = $11, state = $12,
          zipcode = $13, notes = $14, do_not_contact = $15,
          email_opt_out = $16, updated_at = now()
        WHERE id = $2::uuid AND (
          organization_id = $1::uuid
          OR EXISTS (
            SELECT 1 FROM crm.person_organizations membership
            WHERE membership.person_id = $2::uuid
              AND membership.organization_id = $1::uuid
          )
        )
        RETURNING id
      `,
      [input.organizationId, input.personId, input.displayName,
        input.firstName ?? null, input.lastName ?? null, input.title ?? null,
        input.contactType ?? null, input.email ?? null, input.phone ?? null,
        input.street ?? null, input.city ?? null, input.state ?? null,
        input.zipcode ?? null, input.notes ?? null, input.doNotContact,
        input.emailOptOut],
    );
    if (!changed.rowCount) throw new Error("Contact not found.");
    await appendAuditActivity(client, { organizationId: input.organizationId },
      user, `Contact updated: ${input.displayName}`);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  revalidatePath(`/organizations/${input.organizationId}`);
  revalidatePath("/contacts");
}

export async function archiveOrganizationPersonAction(formData: FormData) {
  const user = await requireAdmin();
  const organizationId = uuid.parse(formData.get("organizationId"));
  const personId = uuid.parse(formData.get("personId"));
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const person = await client.query<{ display_name: string }>(
      `UPDATE crm.people SET is_active = false, archived_at = now(),
        archived_by_user_id = $3::uuid, updated_at = now()
       WHERE id = $2::uuid AND (
         organization_id = $1::uuid
         OR EXISTS (
           SELECT 1 FROM crm.person_organizations membership
           WHERE membership.person_id = $2::uuid
             AND membership.organization_id = $1::uuid
         )
       )
       RETURNING display_name`,
      [organizationId, personId, user.id],
    );
    if (!person.rows[0]) throw new Error("Contact not found.");
    await appendAuditActivity(client, { organizationId }, user,
      `Contact archived: ${person.rows[0].display_name}`);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  revalidatePath(`/organizations/${organizationId}`);
  revalidatePath("/contacts");
}

export async function updateOrganizationRelationshipAction(formData: FormData) {
  const user = await requireAdmin();
  const organizationId = uuid.parse(formData.get("organizationId"));
  const relationshipId = uuid.parse(formData.get("relationshipId"));
  const relationshipType = z.string().trim().min(1).max(100)
    .parse(formData.get("relationshipType"));
  const notes = z.string().trim().max(5_000).optional()
    .parse(formData.get("notes") || undefined);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const changed = await client.query(
      `UPDATE crm.organization_relationships
       SET relationship_type = $3, notes = $4
       WHERE id = $2::uuid
         AND (source_organization_id = $1::uuid OR target_organization_id = $1::uuid)
       RETURNING id`,
      [organizationId, relationshipId, relationshipType, notes ?? null],
    );
    if (!changed.rowCount) throw new Error("Relationship not found.");
    await appendAuditActivity(client, { organizationId }, user,
      "Organization relationship updated");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  revalidatePath(`/organizations/${organizationId}`);
}

export async function removeOrganizationRelationshipAction(formData: FormData) {
  const user = await requireAdmin();
  const organizationId = uuid.parse(formData.get("organizationId"));
  const relationshipId = uuid.parse(formData.get("relationshipId"));
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const changed = await client.query(
      `DELETE FROM crm.organization_relationships
       WHERE id = $2::uuid
         AND (source_organization_id = $1::uuid OR target_organization_id = $1::uuid)
       RETURNING id`,
      [organizationId, relationshipId],
    );
    if (!changed.rowCount) throw new Error("Relationship not found.");
    await appendAuditActivity(client, { organizationId }, user,
      "Organization relationship removed");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  revalidatePath(`/organizations/${organizationId}`);
}
