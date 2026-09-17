"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getPool } from "@/db";
import { requireCrmUser } from "@/lib/auth/server";
import { displayUserName } from "@/lib/crm/user-profile";
import { ensureUserGoogleDefaults } from "@/lib/google/google-tokens";

const optionalText = (maximum: number) => z.string().trim().max(maximum);

function refreshSettings() {
  revalidatePath("/", "layout");
  revalidatePath("/settings");
}

export async function updateUserProfileAction(formData: FormData) {
  const user = await requireCrmUser();
  const firstName = optionalText(80).parse(String(formData.get("firstName") ?? ""));
  const lastName = optionalText(80).parse(String(formData.get("lastName") ?? ""));
  const phone = optionalText(40).parse(String(formData.get("phone") ?? ""));
  if (!firstName && !lastName) {
    throw new Error("Enter a first or last name.");
  }
  const name = displayUserName({
    firstName,
    lastName,
    fallback: user.email,
  });
  await getPool().query(
    `
      UPDATE crm.users
      SET first_name = NULLIF($2, ''),
          last_name = NULLIF($3, ''),
          phone = NULLIF($4, ''),
          name = $5,
          updated_at = now()
      WHERE id = $1::uuid
    `,
    [user.id, firstName, lastName, phone, name],
  );
  refreshSettings();
}

export async function updateGoogleAccountDefaultsAction(formData: FormData) {
  const user = await requireCrmUser();
  const sendGoogleSub = String(formData.get("sendGoogleSub") ?? "").trim();
  const calendarGoogleSub = String(formData.get("calendarGoogleSub") ?? "").trim();
  const connections = await getPool().query<{ google_sub: string }>(
    `
      SELECT google_sub
      FROM crm.google_connections
      WHERE user_id = $1::uuid
        AND google_refresh_token_ciphertext IS NOT NULL
    `,
    [user.id],
  );
  const allowed = new Set(connections.rows.map((row) => row.google_sub));
  if (!sendGoogleSub || !allowed.has(sendGoogleSub)) {
    throw new Error("Choose a linked Gmail account for sending.");
  }
  if (!calendarGoogleSub || !allowed.has(calendarGoogleSub)) {
    throw new Error("Choose a linked Google account for Calendar.");
  }
  await getPool().query(
    `
      UPDATE crm.users
      SET default_send_google_sub = $2,
          default_calendar_google_sub = $3,
          updated_at = now()
      WHERE id = $1::uuid
    `,
    [user.id, sendGoogleSub, calendarGoogleSub],
  );
  await ensureUserGoogleDefaults(user.id);
  refreshSettings();
}
