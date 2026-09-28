"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminConsole } from "@/lib/auth/server";
import {
  connectRaceRosterAccount,
  disconnectRaceRosterAccount,
} from "@/lib/race-roster/accounts";

export type ConnectRaceRosterActionResult = {
  ok: boolean;
  message: string;
};

export async function connectRaceRosterAccountAction(
  formData: FormData,
): Promise<ConnectRaceRosterActionResult> {
  const access = await requireAdminConsole();
  const input = z
    .object({
      username: z.string().trim().min(1).max(320),
      password: z.string().min(1).max(500),
    })
    .safeParse({
      username: formData.get("username"),
      password: formData.get("password"),
    });
  if (!input.success) {
    return { ok: false, message: "Enter the Race Roster timer email and password." };
  }
  try {
    await connectRaceRosterAccount({
      connectedByUserId: access.user.id,
      username: input.data.username,
      password: input.data.password,
    });
    revalidatePath("/settings");
    revalidatePath("/admin");
    return { ok: true, message: "Race Roster account linked." };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "Race Roster connect failed.",
    };
  }
}

export async function disconnectRaceRosterAccountAction(formData: FormData) {
  await requireAdminConsole();
  const accountId = z.string().uuid().parse(String(formData.get("accountId") ?? ""));
  await disconnectRaceRosterAccount(accountId);
  revalidatePath("/settings");
  revalidatePath("/admin");
}
