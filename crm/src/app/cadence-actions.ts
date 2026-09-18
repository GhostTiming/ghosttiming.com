"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getPool } from "@/db";
import { requireProspectingAccess } from "@/lib/auth/server";
import {
  approveCadenceStepSend,
  declineCadenceStepSend,
  enrollProspectInCadence,
  processCadenceReplies,
} from "@/lib/crm/cadence";
import { startProspectFromListing } from "@/lib/crm/mutations";
import type { BulkActionResult } from "@/app/bulk-actions";
import { parseBulkIds, parseBulkListingIds } from "@/lib/crm/bulk-update";

const uuid = z.string().uuid();

function refreshCadence(prospectId?: string) {
  revalidatePath("/prospecting", "layout");
  revalidatePath("/prospecting/pending-emails", "layout");
  revalidatePath("/dashboard", "layout");
  if (prospectId) revalidatePath(`/prospecting/${prospectId}`, "layout");
}

function actorFromUser(user: {
  id: string;
  name: string;
  defaultSendGoogleSub?: string | null;
}) {
  return {
    id: user.id,
    name: user.name,
    actorType: "system" as const,
    actorName: "System",
    defaultSendGoogleSub: user.defaultSendGoogleSub,
  };
}

export async function enrollProspectInCadenceAction(
  _prev: { ok: boolean; message: string } | null,
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  const access = await requireProspectingAccess();
  try {
    const prospectId = uuid.parse(formData.get("prospectId"));
    const cadenceId = String(formData.get("cadenceId") ?? "").trim() || null;
    const result = await enrollProspectInCadence({
      prospectId,
      cadenceId,
      actor: actorFromUser(access.user),
    });
    refreshCadence(prospectId);
    return { ok: true, message: result.message };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not start the cadence.";
    console.error("enrollProspectInCadenceAction", message);
    return { ok: false, message };
  }
}

export async function approveCadenceSendAction(formData: FormData) {
  const access = await requireProspectingAccess();
  const sendId = uuid.parse(formData.get("sendId"));
  const result = await approveCadenceStepSend({
    sendId,
    actor: actorFromUser(access.user),
  });
  refreshCadence(result.prospectId);
  return result;
}

export async function declineCadenceSendAction(formData: FormData) {
  const access = await requireProspectingAccess();
  const sendId = uuid.parse(formData.get("sendId"));
  const result = await declineCadenceStepSend({
    sendId,
    actor: actorFromUser(access.user),
  });
  refreshCadence(result.prospectId);
  return result;
}

export async function processCadenceRepliesAction() {
  await requireProspectingAccess();
  const result = await processCadenceReplies();
  refreshCadence();
  return result;
}

function bulkResult(
  updated: number,
  skipped: number,
  failed: number,
  extra?: string,
): BulkActionResult {
  const message = [`${updated} updated`, `${skipped} skipped`, `${failed} failed`]
    .concat(extra ? [extra] : [])
    .join(", ");
  return { ok: failed === 0, updated, skipped, failed, message };
}

export async function bulkEnrollProspectsInCadenceAction(
  ids: string[],
): Promise<BulkActionResult> {
  const access = await requireProspectingAccess();
  const parsed = parseBulkIds(ids);
  if (!parsed.success) return bulkResult(0, 0, 0, parsed.error);
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const prospectId of parsed.ids) {
    try {
      const result = await enrollProspectInCadence({
        prospectId,
        actor: actorFromUser(access.user),
      });
      if (result.sent) updated += 1;
      else skipped += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not enroll.";
      if (/already in an active cadence/i.test(message)) skipped += 1;
      else {
        failed += 1;
        if (errors.length < 3) errors.push(message);
      }
    }
  }
  refreshCadence();
  return bulkResult(updated, skipped, failed, errors.join(" "));
}

export async function bulkStartCadenceFromListingsAction(
  ids: string[],
): Promise<BulkActionResult> {
  const access = await requireProspectingAccess();
  const parsed = parseBulkListingIds(ids);
  if (!parsed.success) return bulkResult(0, 0, 0, parsed.error);
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const listingId of parsed.ids) {
    const client = await getPool().connect();
    let prospectId: string;
    try {
      await client.query("BEGIN");
      prospectId = await startProspectFromListing(client, {
        raceListingId: listingId,
        userId: access.user.id,
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      failed += 1;
      if (errors.length < 3) {
        errors.push(error instanceof Error ? error.message : "Could not start lead.");
      }
      continue;
    } finally {
      client.release();
    }
    try {
      const result = await enrollProspectInCadence({
        prospectId,
        actor: actorFromUser(access.user),
      });
      if (result.sent) updated += 1;
      else skipped += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not enroll.";
      if (/already in an active cadence/i.test(message)) skipped += 1;
      else {
        failed += 1;
        if (errors.length < 3) errors.push(message);
      }
    }
  }
  refreshCadence();
  return bulkResult(updated, skipped, failed, errors.join(" "));
}
