"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getPool } from "@/db";
import { requireProspectingUser } from "@/lib/auth/server";
import { appendAuditActivity } from "@/lib/crm/audit";
import { syncProspectNextStepTask } from "@/lib/crm/next-step-task";
import {
  asCatalogQuery,
  clearCatalogMatchDismissed,
  dismissCatalogMatch,
  linkEventToCatalogListing,
  loadCatalogListingCandidates,
  resolveCatalogListingQuery,
  unlinkEventFromCatalogListing,
} from "@/lib/crm/catalog-link";
import { catalogListingSearchQuery } from "@/lib/crm/catalog-search";
import { changeProspectStage, findOrCreateStandingEvent } from "@/lib/crm/mutations";
import { cancelOpenProspectTasks, PAST_EVENT_STAGE_KEY } from "@/lib/crm/past-events";
import { refreshCatalogLinkedViews } from "@/lib/crm/revalidate";

const uuid = z.string().uuid();
const optionalUuid = uuid.optional();
const optionalText = (max: number) => z.string().trim().max(max).optional();

function refreshProspect(prospectId: string, eventId?: string | null) {
  refreshCatalogLinkedViews({ prospectId, eventId });
  revalidatePath("/tasks");
}

function closedLostFromForm(formData: FormData) {
  return {
    reason: String(formData.get("closedLostReason") ?? "") || null,
    note: String(formData.get("closedLostNote") ?? "") || null,
    circleBackOn: String(formData.get("circleBackOn") ?? "") || null,
  };
}

function outcomeFromForm(formData: FormData, stageKey: string) {
  const reason =
    String(formData.get("outcomeReason") ?? formData.get("reason") ?? "") ||
    null;
  const note =
    String(formData.get("outcomeNote") ?? formData.get("note") ?? "") || null;
  if (stageKey === "unqualified") {
    return { unqualified: { reason, note }, disqualified: null };
  }
  if (stageKey === "disqualified") {
    return { unqualified: null, disqualified: { reason, note } };
  }
  return null;
}

export async function updateProspectStageAction(formData: FormData) {
  const user = await requireProspectingUser();
  const input = z.object({
    prospectId: uuid,
    stageKey: z.string().trim().min(1).max(80),
  }).parse({
    prospectId: formData.get("prospectId"),
    stageKey: formData.get("stageKey"),
  });
  const closedLost =
    input.stageKey === "closed_lost" ? closedLostFromForm(formData) : null;
  const outcome = outcomeFromForm(formData, input.stageKey);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await changeProspectStage(client, input.prospectId, input.stageKey, {
      actorType: "human",
      actorUserId: user.id,
      actorName: user.name,
    }, closedLost, outcome);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  refreshProspect(input.prospectId);
}

export async function updateProspectEventAction(formData: FormData) {
  const user = await requireProspectingUser();
  const input = z.object({
    prospectId: uuid,
    eventId: uuid,
    occurrenceId: uuid,
    eventName: z.string().trim().min(1).max(500),
    raceDate: z.string().optional(),
    timezone: z.string().trim().min(1).max(100),
    registrationUrl: z.string().trim().url().max(2_000).optional(),
    street: optionalText(500),
    street2: optionalText(500),
    city: optionalText(200),
    state: optionalText(100),
    zipcode: optionalText(30),
  }).parse({
    prospectId: formData.get("prospectId"),
    eventId: formData.get("eventId"),
    occurrenceId: formData.get("occurrenceId"),
    eventName: formData.get("eventName"),
    raceDate: formData.get("raceDate") || undefined,
    timezone: formData.get("timezone") || "America/New_York",
    registrationUrl: formData.get("registrationUrl") || undefined,
    street: formData.get("street") || undefined,
    street2: formData.get("street2") || undefined,
    city: formData.get("city") || undefined,
    state: formData.get("state") || undefined,
    zipcode: formData.get("zipcode") || undefined,
  });
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const owns = await client.query(
      `SELECT 1 FROM crm.prospects
       WHERE id = $1::uuid AND event_id = $2::uuid AND occurrence_id = $3::uuid
       FOR UPDATE`,
      [input.prospectId, input.eventId, input.occurrenceId],
    );
    if (!owns.rowCount) throw new Error("Prospect event not found.");
    await client.query(
      `UPDATE crm.events SET name = $2, website = $3, updated_at = now()
       WHERE id = $1::uuid`,
      [input.eventId, input.eventName, input.registrationUrl ?? null],
    );
    await client.query(
      `UPDATE crm.event_occurrences
       SET race_date = CASE WHEN $2::text IS NULL THEN NULL
             ELSE $2::timestamp AT TIME ZONE $3 END,
           occurrence_year = CASE WHEN $2::text IS NULL THEN occurrence_year
             ELSE EXTRACT(YEAR FROM $2::timestamp)::integer END,
           timezone = $3, registration_url_override = $4,
           street_override = $5, street2_override = $6, city_override = $7,
           state_override = $8, zipcode_override = $9, updated_at = now()
       WHERE id = $1::uuid`,
      [input.occurrenceId, input.raceDate ?? null, input.timezone,
        input.registrationUrl ?? null, input.street ?? null,
        input.street2 ?? null, input.city ?? null, input.state ?? null,
        input.zipcode ?? null],
    );
    await appendAuditActivity(client, { prospectId: input.prospectId }, user,
      "Private event details updated",
      { catalogSourceUnchanged: true });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  refreshProspect(input.prospectId);
  redirect(`/prospecting/${input.prospectId}`);
}

export async function updateProspectRoutingAction(formData: FormData) {
  const user = await requireProspectingUser();
  const input = z.object({
    prospectId: uuid,
    stageKey: z.string().trim().min(1).max(80),
    assignedUserId: optionalUuid,
    primaryContactPersonId: optionalUuid,
    doNotContact: z.boolean(),
  }).parse({
    prospectId: formData.get("prospectId"),
    stageKey: formData.get("stageKey"),
    assignedUserId: formData.get("assignedUserId") || undefined,
    primaryContactPersonId: formData.get("primaryContactPersonId") || undefined,
    doNotContact: formData.get("doNotContact") === "on",
  });
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const changed = await client.query(
      `UPDATE crm.prospects prospect
       SET stage_id = stage.id, assigned_user_id = $3::uuid,
         primary_contact_person_id = $4::uuid, do_not_contact = $5,
         closed_at = CASE WHEN stage.is_terminal THEN
           COALESCE(prospect.closed_at, now()) ELSE NULL END,
         updated_at = now()
       FROM crm.pipeline_stages stage
       WHERE prospect.id = $1::uuid AND stage.pipeline = 'prospect'
         AND stage.key = $2 AND stage.is_active = true
       RETURNING prospect.id`,
      [input.prospectId, input.stageKey, input.assignedUserId ?? null,
        input.primaryContactPersonId ?? null, input.doNotContact],
    );
    if (!changed.rowCount) throw new Error("Prospect or stage not found.");
    if (input.stageKey === PAST_EVENT_STAGE_KEY) {
      await cancelOpenProspectTasks(client, [input.prospectId]);
    }
    await appendAuditActivity(client, { prospectId: input.prospectId }, user,
      "Stage, owner, contact, or contact preference updated");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  refreshProspect(input.prospectId);
  redirect(`/prospecting/${input.prospectId}`);
}

export async function saveProspectContactMethodAction(formData: FormData) {
  const user = await requireProspectingUser();
  const input = z.object({
    prospectId: uuid,
    contactMethodId: optionalUuid,
    type: z.enum(["email", "phone"]),
    value: z.string().trim().min(1).max(500),
    label: optionalText(200),
    isPrimary: z.boolean(),
    status: z.enum(["unknown", "valid", "invalid", "opted_out"]),
  }).parse({
    prospectId: formData.get("prospectId"),
    contactMethodId: formData.get("contactMethodId") || undefined,
    type: formData.get("type"),
    value: formData.get("value"),
    label: formData.get("label") || undefined,
    isPrimary: formData.get("isPrimary") === "on",
    status: formData.get("status") || "unknown",
  });
  if (input.type === "email") z.string().email().parse(input.value);
  const normalized = input.type === "email"
    ? input.value.toLowerCase()
    : input.value.replace(/\D/g, "");
  if (!normalized) throw new Error("Enter a valid contact method.");
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const prospect = await client.query<{ race_listing_id: string | null }>(
      `SELECT race_listing_id FROM crm.prospects WHERE id = $1::uuid FOR UPDATE`,
      [input.prospectId],
    );
    if (!prospect.rows[0]) throw new Error("Prospect not found.");
    if (input.isPrimary) {
      await client.query(
        `UPDATE crm.contact_methods SET is_primary = false, updated_at = now()
         WHERE prospect_id = $1::uuid AND type = $2::crm.contact_method_type`,
        [input.prospectId, input.type],
      );
    }
    if (input.contactMethodId) {
      const changed = await client.query(
        `UPDATE crm.contact_methods SET type = $3::crm.contact_method_type,
           raw_value = $4, normalized_value = $5, label = $6,
           is_primary = $7, status = $8::crm.contact_method_status,
           source = 'manual', updated_at = now()
         WHERE id = $2::uuid AND prospect_id = $1::uuid RETURNING id`,
        [input.prospectId, input.contactMethodId, input.type, input.value,
          normalized, input.label ?? null, input.isPrimary, input.status],
      );
      if (!changed.rowCount) throw new Error("Contact method not found.");
    } else {
      await client.query(
        `INSERT INTO crm.contact_methods
          (prospect_id, race_listing_id, type, raw_value, normalized_value,
           label, source, is_primary, status)
         VALUES ($1::uuid, $2, $3::crm.contact_method_type, $4, $5, $6,
           'manual', $7, $8::crm.contact_method_status)
         ON CONFLICT (prospect_id, type, normalized_value)
         DO UPDATE SET raw_value = EXCLUDED.raw_value, label = EXCLUDED.label,
           is_primary = EXCLUDED.is_primary, status = EXCLUDED.status,
           updated_at = now()`,
        [input.prospectId, prospect.rows[0].race_listing_id, input.type,
          input.value, normalized, input.label ?? null, input.isPrimary,
          input.status],
      );
    }
    await appendAuditActivity(client, { prospectId: input.prospectId }, user,
      `${input.type === "email" ? "Email" : "Phone"} contact updated`);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  refreshProspect(input.prospectId);
}

export async function removeProspectContactMethodAction(formData: FormData) {
  const user = await requireProspectingUser();
  const prospectId = uuid.parse(formData.get("prospectId"));
  const contactMethodId = uuid.parse(formData.get("contactMethodId"));
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const removed = await client.query<{ type: string }>(
      `DELETE FROM crm.contact_methods
       WHERE id = $2::uuid AND prospect_id = $1::uuid
       RETURNING type::text`,
      [prospectId, contactMethodId],
    );
    if (!removed.rows[0]) throw new Error("Contact method not found.");
    await appendAuditActivity(client, { prospectId }, user,
      `${removed.rows[0].type} contact removed`);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  refreshProspect(prospectId);
}

export async function createManualProspectAction(formData: FormData) {
  const user = await requireProspectingUser();
  const input = z.object({
    eventName: z.string().trim().min(1).max(500),
    raceDate: z.string().optional(),
    timezone: z.string().trim().min(1).max(100),
    registrationUrl: z.string().trim().url().max(2_000).optional(),
    street: optionalText(500),
    street2: optionalText(500),
    city: optionalText(200),
    state: optionalText(100),
    zipcode: optionalText(30),
    stageKey: z.string().trim().min(1).max(80),
    assignedUserId: optionalUuid,
    organizationId: optionalUuid,
    contactName: optionalText(300),
    email: z.string().trim().email().optional(),
    phone: optionalText(100),
    notes: optionalText(20_000),
  }).parse({
    eventName: formData.get("eventName"),
    raceDate: formData.get("raceDate") || undefined,
    timezone: formData.get("timezone") || "America/New_York",
    registrationUrl: formData.get("registrationUrl") || undefined,
    street: formData.get("street") || undefined,
    street2: formData.get("street2") || undefined,
    city: formData.get("city") || undefined,
    state: formData.get("state") || undefined,
    zipcode: formData.get("zipcode") || undefined,
    stageKey: formData.get("stageKey") || "cold",
    assignedUserId: formData.get("assignedUserId") || undefined,
    organizationId: formData.get("organizationId") || undefined,
    contactName: formData.get("contactName") || undefined,
    email: formData.get("email") || undefined,
    phone: formData.get("phone") || undefined,
    notes: formData.get("notes") || undefined,
  });
  const client = await getPool().connect();
  let prospectId = "";
  try {
    await client.query("BEGIN");
    const eventId = await findOrCreateStandingEvent(client, {
      name: input.eventName,
      website: input.registrationUrl ?? null,
      notes: input.notes ?? null,
    });
    const occurrence = await client.query<{ id: string }>(
      `INSERT INTO crm.event_occurrences
        (event_id, occurrence_year, race_date, timezone,
         registration_url_override, street_override, street2_override,
         city_override, state_override, zipcode_override)
       VALUES ($1::uuid,
         CASE WHEN $2::text IS NULL THEN NULL
           ELSE EXTRACT(YEAR FROM $2::timestamp)::integer END,
         CASE WHEN $2::text IS NULL THEN NULL
           ELSE $2::timestamp AT TIME ZONE $3 END,
         $3, $4, $5, $6, $7, $8, $9)
       RETURNING id::text`,
      [eventId, input.raceDate ?? null, input.timezone,
        input.registrationUrl ?? null, input.street ?? null,
        input.street2 ?? null, input.city ?? null, input.state ?? null,
        input.zipcode ?? null],
    );
    let personId: string | null = null;
    if (input.contactName || input.email || input.phone) {
      const person = await client.query<{ id: string }>(
        `INSERT INTO crm.people
          (organization_id, display_name, email, phone, notes)
         VALUES ($1::uuid, $2, $3, $4, $5) RETURNING id::text`,
        [input.organizationId ?? null,
          input.contactName ?? input.email ?? input.phone ?? "Lead contact",
          input.email ?? null, input.phone ?? null, null],
      );
      personId = person.rows[0].id;
      if (input.organizationId) {
        await client.query(
          `
            INSERT INTO crm.person_organizations (person_id, organization_id)
            VALUES ($1::uuid, $2::uuid)
            ON CONFLICT (person_id, organization_id) DO NOTHING
          `,
          [personId, input.organizationId],
        );
      }
    }
    const prospect = await client.query<{ id: string }>(
      `INSERT INTO crm.prospects
        (event_id, occurrence_id, primary_contact_person_id, assigned_user_id,
         stage_id)
       SELECT $1::uuid, $2::uuid, $3::uuid, $4::uuid, stage.id
       FROM crm.pipeline_stages stage
       WHERE stage.pipeline = 'prospect' AND stage.key = $5 AND stage.is_active
       RETURNING id::text`,
      [eventId, occurrence.rows[0].id, personId,
        input.assignedUserId ?? user.id, input.stageKey],
    );
    if (!prospect.rows[0]) throw new Error("Prospect stage not found.");
    prospectId = prospect.rows[0].id;
    if (input.email) {
      await client.query(
        `INSERT INTO crm.contact_methods
          (prospect_id, type, raw_value, normalized_value, source, is_primary)
         VALUES ($1::uuid, 'email', $2, lower($2), 'manual', true)`,
        [prospectId, input.email],
      );
    }
    if (input.phone) {
      await client.query(
        `INSERT INTO crm.contact_methods
          (prospect_id, type, raw_value, normalized_value, source, is_primary)
         VALUES ($1::uuid, 'phone', $2, regexp_replace($2, '[^0-9]', '', 'g'),
           'manual', true)`,
        [prospectId, input.phone],
      );
    }
    await appendAuditActivity(client, { prospectId }, user,
      "Manual lead created");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  revalidatePath("/events");
  revalidatePath("/prospecting");
  redirect(`/prospecting/${prospectId}`);
}

function prospectReturnTo(value: FormDataEntryValue | null, fallback: string) {
  const text = typeof value === "string" ? value : "";
  return text.startsWith("/prospecting") ? text : fallback;
}

export async function matchProspectCatalogListingAction(formData: FormData) {
  const user = await requireProspectingUser();
  const prospectId = uuid.parse(formData.get("prospectId"));
  const listingIdValue = String(formData.get("listingId") ?? "").trim();
  const listingQuery = String(formData.get("listingQuery") ?? "").trim();
  const returnTo = prospectReturnTo(
    formData.get("returnTo"),
    `/prospecting/${prospectId}`,
  );
  const client = await getPool().connect();
  let searchRedirect: string | null = null;
  let eventId: string | undefined;
  try {
    await client.query("BEGIN");
    const prospect = await client.query<{
      event_id: string;
      occurrence_id: string | null;
      catalog_race_listing_id: string | null;
    }>(
      `SELECT event.id::text AS event_id,
              occurrence.id::text AS occurrence_id,
              event.catalog_race_listing_id
       FROM crm.prospects prospect
       JOIN crm.events event ON event.id = prospect.event_id
       LEFT JOIN crm.event_occurrences occurrence
         ON occurrence.id = prospect.occurrence_id
       WHERE prospect.id = $1::uuid`,
      [prospectId],
    );
    const row = prospect.rows[0];
    if (!row) throw new Error("Prospect not found.");
    eventId = row.event_id;
    if (!row.catalog_race_listing_id) {
      let listingId = listingIdValue;
      if (!listingId && listingQuery) {
        const context = await loadCatalogListingCandidates(
          asCatalogQuery((sql, params) => client.query(sql, params)),
          { search: listingQuery },
        );
        const resolved = resolveCatalogListingQuery(
          listingQuery,
          context.listings,
          context.takenIds,
        );
        if ("match" in resolved && resolved.match) {
          listingId = resolved.match.id;
        } else {
          searchRedirect = `/prospecting/${prospectId}?listingQ=${encodeURIComponent(listingQuery)}`;
        }
      }
      if (!searchRedirect) {
        if (!listingId) throw new Error("Choose a Get Run Vibes listing to match.");
        await linkEventToCatalogListing(client, {
          eventId: row.event_id,
          listingId,
          occurrenceId: row.occurrence_id,
          actor: user,
          archiveProspects: false,
        });
        await appendAuditActivity(
          client,
          { prospectId },
          user,
          "Matched Get Run Vibes listing",
          { raceListingId: listingId },
        );
      }
    }
    if (searchRedirect) await client.query("ROLLBACK");
    else await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  refreshProspect(prospectId, eventId);
  redirect(searchRedirect ?? returnTo);
}

export async function dismissProspectCatalogMatchAction(formData: FormData) {
  const user = await requireProspectingUser();
  const prospectId = uuid.parse(formData.get("prospectId"));
  const returnTo = prospectReturnTo(
    formData.get("returnTo"),
    `/prospecting/${prospectId}`,
  );
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const prospect = await client.query<{ event_id: string }>(
      `SELECT event.id::text AS event_id
       FROM crm.prospects prospect
       JOIN crm.events event ON event.id = prospect.event_id
       WHERE prospect.id = $1::uuid`,
      [prospectId],
    );
    if (!prospect.rows[0]) throw new Error("Prospect not found.");
    await dismissCatalogMatch(client, prospect.rows[0].event_id);
    await appendAuditActivity(
      client,
      { prospectId },
      user,
      "Marked as not in Get Run Vibes",
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  refreshProspect(prospectId);
  redirect(returnTo);
}

export async function restoreProspectCatalogMatchAction(formData: FormData) {
  const user = await requireProspectingUser();
  const prospectId = uuid.parse(formData.get("prospectId"));
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const prospect = await client.query<{ event_id: string }>(
      `SELECT event.id::text AS event_id
       FROM crm.prospects prospect
       JOIN crm.events event ON event.id = prospect.event_id
       WHERE prospect.id = $1::uuid`,
      [prospectId],
    );
    if (!prospect.rows[0]) throw new Error("Prospect not found.");
    await clearCatalogMatchDismissed(client, prospect.rows[0].event_id);
    await appendAuditActivity(
      client,
      { prospectId },
      user,
      "Returned to Get Run Vibes listing review",
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  refreshProspect(prospectId);
  redirect(`/prospecting/${prospectId}`);
}

export async function unlinkProspectCatalogListingAction(formData: FormData) {
  const user = await requireProspectingUser();
  const prospectId = uuid.parse(formData.get("prospectId"));
  const client = await getPool().connect();
  let eventId: string | undefined;
  let listingQuery = "";
  try {
    await client.query("BEGIN");
    const prospect = await client.query<{
      event_id: string;
      event_name: string;
      city: string | null;
      state: string | null;
    }>(
      `SELECT event.id::text AS event_id,
              event.name AS event_name,
              COALESCE(occurrence.city_override, listing.city) AS city,
              COALESCE(occurrence.state_override, listing.state) AS state
       FROM crm.prospects prospect
       JOIN crm.events event ON event.id = prospect.event_id
       LEFT JOIN crm.event_occurrences occurrence
         ON occurrence.id = prospect.occurrence_id
       LEFT JOIN catalog.race_listings listing
         ON listing.id = COALESCE(event.catalog_race_listing_id, prospect.race_listing_id)
       WHERE prospect.id = $1::uuid`,
      [prospectId],
    );
    if (!prospect.rows[0]) throw new Error("Prospect not found.");
    eventId = prospect.rows[0].event_id;
    listingQuery = catalogListingSearchQuery({
      name: prospect.rows[0].event_name,
      city: prospect.rows[0].city,
      state: prospect.rows[0].state,
    });
    await unlinkEventFromCatalogListing(client, eventId);
    await appendAuditActivity(
      client,
      { prospectId },
      user,
      "Uncoupled Get Run Vibes listing",
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  refreshProspect(prospectId, eventId);
  const listingQ = listingQuery
    ? `?listingQ=${encodeURIComponent(listingQuery)}`
    : "";
  redirect(`/prospecting/${prospectId}${listingQ}`);
}

export async function updateProspectGlanceAction(formData: FormData) {
  const user = await requireProspectingUser();
  const input = z.object({
    prospectId: uuid,
    lastStepNote: optionalText(4_000),
    nextStepOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    nextStepNote: optionalText(2_000),
  }).parse({
    prospectId: formData.get("prospectId"),
    lastStepNote: formData.get("lastStepNote") || undefined,
    nextStepOn: String(formData.get("nextStepOn") ?? "").trim() || undefined,
    nextStepNote: formData.get("nextStepNote") || undefined,
  });
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query<{
      assigned_user_id: string | null;
      next_step_on: string | null;
      next_step_note: string | null;
    }>(
      `SELECT assigned_user_id::text,
              next_step_on::text,
              next_step_note
       FROM crm.prospects
       WHERE id = $1::uuid
       FOR UPDATE`,
      [input.prospectId],
    );
    const prospect = existing.rows[0];
    if (!prospect) throw new Error("Prospect not found.");
    await client.query(
      `UPDATE crm.prospects
       SET last_step_note = $2,
           next_step_on = $3::date,
           next_step_note = $4,
           updated_at = now()
       WHERE id = $1::uuid`,
      [
        input.prospectId,
        input.lastStepNote ?? null,
        input.nextStepOn ?? null,
        input.nextStepNote ?? null,
      ],
    );
    await syncProspectNextStepTask(client, {
      prospectId: input.prospectId,
      assignedUserId: prospect.assigned_user_id ?? user.id,
      actor: { id: user.id, name: user.name },
      previous: {
        nextStepOn: prospect.next_step_on,
        nextStepNote: prospect.next_step_note,
      },
      nextStepOn: input.nextStepOn,
      nextStepNote: input.nextStepNote,
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  refreshProspect(input.prospectId);
}

