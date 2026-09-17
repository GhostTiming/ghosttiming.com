"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getPool } from "@/db";
import { requireProspectingUser } from "@/lib/auth/server";
import {
  closeCandidateListing,
  startProspectFromListing,
} from "@/lib/crm/mutations";

export async function startProspectAction(formData: FormData) {
  const user = await requireProspectingUser();
  const raceListingId = z.string().min(1).max(200).parse(formData.get("raceListingId"));
  const client = await getPool().connect();
  let prospectId: string;

  try {
    await client.query("BEGIN");
    prospectId = await startProspectFromListing(client, {
      raceListingId,
      userId: user.id,
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  redirect(`/prospecting/${prospectId}`);
}

export async function closeCandidateListingAction(formData: FormData) {
  const user = await requireProspectingUser();
  const raceListingId = z.string().min(1).max(200).parse(formData.get("raceListingId"));
  const stageKey = z.enum(["disqualified", "unqualified"]).parse(formData.get("stageKey"));
  const reason = String(formData.get("outcomeReason") ?? "").trim() || null;
  const note = String(formData.get("outcomeNote") ?? "").trim() || null;
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
    await closeCandidateListing(client, {
      raceListingId,
      userId: user.id,
      userName: user.name,
      stageKey,
      reason,
      note,
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  redirect("/prospecting?view=candidate");
}
