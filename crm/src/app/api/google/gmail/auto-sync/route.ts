import { NextResponse } from "next/server";
import { getAccessContext } from "@/lib/auth/server";
import { syncStoredGmailAccounts } from "@/lib/google/gmail-auto-sync";
import { rethrowNextControlFlow } from "@/lib/next-control-flow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  try {
    const access = await getAccessContext();
    if (!access.canAccessGoogle) {
      return NextResponse.json({ error: "Google access is required." }, { status: 403 });
    }
    const result = await syncStoredGmailAccounts({
      userId: access.user.id,
      organizationIds: access.isSuperAdmin ? null : access.assignedOrgIds,
    });
    return NextResponse.json(result);
  } catch (error) {
    rethrowNextControlFlow(error);
    const message = error instanceof Error ? error.message : "Gmail sync failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
