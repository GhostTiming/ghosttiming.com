import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  sanitizeCrewSnapshot,
  secretsConfigured,
  snapshotByteLimitExceeded,
  verifyCrewWriteToken,
} from "@/lib/crew-auth";
import { checkCrewWriteRate } from "@/lib/crew-rate-limit";
import { writeCrewSnapshot } from "@/lib/crew-store";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!secretsConfigured().writeToken) {
    return NextResponse.json(
      { error: "Crew live write token is not configured." },
      { status: 503 },
    );
  }
  if (!verifyCrewWriteToken(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const raw = await req.json().catch(() => null);
  if (snapshotByteLimitExceeded(raw)) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }
  const payload = sanitizeCrewSnapshot(raw);
  if (!payload) {
    return NextResponse.json({ error: "Invalid snapshot" }, { status: 400 });
  }
  if (!checkCrewWriteRate(`snap:${payload.event_id}`)) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }
  await writeCrewSnapshot(payload.event_id, payload);
  return NextResponse.json({ ok: true, event_id: payload.event_id });
}
