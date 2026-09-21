import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  requireCrewRequest,
  sanitizeCrewIndex,
  secretsConfigured,
  snapshotByteLimitExceeded,
  verifyCrewWriteToken,
} from "@/lib/crew-auth";
import { checkCrewWriteRate } from "@/lib/crew-rate-limit";
import { readCrewIndex, writeCrewIndex } from "@/lib/crew-store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await requireCrewRequest(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const payload = sanitizeCrewIndex(await readCrewIndex()) ?? {
    schema: 1 as const,
    updated_at: 0,
    events: [],
  };
  return NextResponse.json(payload);
}

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
  if (!checkCrewWriteRate("index")) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }
  const raw = await req.json().catch(() => null);
  if (snapshotByteLimitExceeded(raw)) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }
  const payload = sanitizeCrewIndex(raw);
  if (!payload) {
    return NextResponse.json({ error: "Invalid index" }, { status: 400 });
  }
  await writeCrewIndex(payload);
  return NextResponse.json({ ok: true });
}
