import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { requireViewerAuth } from "@/lib/resolve-event";
import { buildSnapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { shortId: string } },
) {
  const shortId = params.shortId;
  const auth = await requireViewerAuth(db, req, shortId);
  if ("error" in auth) return auth.error;

  const secondsParam = req.nextUrl.searchParams.get("recentSeconds");
  const recentSeconds = secondsParam
    ? Math.min(3600, Math.max(60, parseInt(secondsParam, 10) || 600))
    : 600;

  const snap = await buildSnapshot(db, auth.event.id, shortId, recentSeconds);
  return NextResponse.json(snap);
}
