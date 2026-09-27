"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminConsole } from "@/lib/auth/server";
import { disconnectRunSignupAccount } from "@/lib/runsignup/accounts";

export async function disconnectRunSignupAccountAction(formData: FormData) {
  await requireAdminConsole();
  const accountId = z.string().uuid().parse(String(formData.get("accountId") ?? ""));
  await disconnectRunSignupAccount(accountId);
  revalidatePath("/settings");
}
