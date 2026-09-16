import { NextResponse } from "next/server";
import { requireCrmUser } from "@/lib/auth/server";
import { loadEmailMatchIndex } from "@/lib/crm/google-queries";

export async function GET() {
  await requireCrmUser();
  const entries = await loadEmailMatchIndex();
  return NextResponse.json({
    count: entries.length,
    index: Object.fromEntries(entries.map((entry) => [entry.email, entry])),
  });
}
