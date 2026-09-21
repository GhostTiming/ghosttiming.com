import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireCrewRequest, sanitizeCrewSnapshot } from "@/lib/crew-auth";
import { readCrewSnapshot } from "@/lib/crew-store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await requireCrewRequest(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const eventId = String(req.nextUrl.searchParams.get("event_id") ?? "").trim();
  if (!/^[0-9a-fA-F-]{8,64}$/.test(eventId)) {
    return NextResponse.json({ error: "Missing event" }, { status: 400 });
  }
  const payload = sanitizeCrewSnapshot(await readCrewSnapshot(eventId));
  if (!payload) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(payload);
}
