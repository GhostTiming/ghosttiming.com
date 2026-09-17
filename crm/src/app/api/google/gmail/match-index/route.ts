import { NextResponse } from "next/server";
import { getAccessContext } from "@/lib/auth/server";
import { loadEmailMatchIndex } from "@/lib/crm/google-queries";

export async function GET() {
  const access = await getAccessContext();
  const entries = await loadEmailMatchIndex({
    organizationIds: access.isSuperAdmin ? null : access.assignedOrgIds,
  });
  return NextResponse.json({
    count: entries.length,
    index: Object.fromEntries(entries.map((entry) => [entry.email, entry])),
  });
}
