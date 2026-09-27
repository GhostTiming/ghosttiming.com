import { NextResponse } from "next/server";
import { syncStoredGmailAccounts } from "@/lib/google/gmail-auto-sync";
import { cronAuthorizationStatus } from "@/lib/google/gmail-auto-sync-plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const status = cronAuthorizationStatus(
    request.headers.get("authorization"),
    process.env.CRON_SECRET,
    process.env.NODE_ENV,
  );
  if (status) {
    return NextResponse.json(
      { error: status === 503 ? "CRON_SECRET is not configured." : "Unauthorized" },
      { status },
    );
  }
  try {
    const result = await syncStoredGmailAccounts();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gmail sync failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
