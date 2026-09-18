"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getPool } from "@/db";
import { requireProspectingUser } from "@/lib/auth/server";
import {
  applyEmailBlacklist,
  parseBlacklistPattern,
} from "@/lib/crm/email-blacklist";
import { emailBlacklistReasons, parseDisqualifiedDetails } from "@/lib/crm/domain";

function revalidateBlacklist() {
  revalidatePath("/prospecting");
  revalidatePath("/prospecting/blacklist");
}

export async function addEmailBlacklistAction(formData: FormData) {
  const user = await requireProspectingUser();
  const parsed = parseBlacklistPattern(String(formData.get("pattern") ?? ""));
  if (!parsed.success) throw new Error(parsed.error);
  const details = parseDisqualifiedDetails({
    reason: String(formData.get("reason") ?? ""),
    note: String(formData.get("note") ?? ""),
  });
  if (!(emailBlacklistReasons as readonly string[]).includes(details.reason)) {
    throw new Error("Choose a valid blacklist reason.");
  }
  const client = await getPool().connect();
  let closed = 0;
  try {
    await client.query("BEGIN");
    await client.query(
      `
        INSERT INTO crm.prospect_email_blacklist
          (pattern, match_kind, reason, note, created_by_user_id)
        VALUES ($1, $2, $3, $4, $5::uuid)
      `,
      [parsed.pattern, parsed.matchKind, details.reason, details.note, user.id],
    );
    const applied = await applyEmailBlacklist(client, user);
    closed = applied.closed;
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "";
    if (code === "23505") {
      throw new Error("That email or domain is already on the blacklist.");
    }
    throw error;
  } finally {
    client.release();
  }
  revalidateBlacklist();
  return { closed };
}

export async function deleteEmailBlacklistAction(formData: FormData) {
  await requireProspectingUser();
  const id = z.string().uuid().parse(formData.get("id"));
  await getPool().query(
    `DELETE FROM crm.prospect_email_blacklist WHERE id = $1::uuid`,
    [id],
  );
  revalidateBlacklist();
}
