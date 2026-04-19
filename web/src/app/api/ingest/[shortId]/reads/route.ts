import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { eq, sql } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { events, macsEvent, portsEvent, reads } from "@/db/schema";
import { getEventByShortId } from "@/lib/resolve-event";
import { checkIngestRate } from "@/lib/ingest-rate-limit";

export const dynamic = "force-dynamic";

const MAX_BATCH = 500;

function parseClientTs(t: number): Date {
  if (!Number.isFinite(t)) return new Date();
  if (t > 10_000_000_000) return new Date(t);
  return new Date(t * 1000);
}

export async function POST(
  req: NextRequest,
  { params }: { params: { shortId: string } },
) {
  const shortId = params.shortId;
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rawToken = authHeader.slice(7).trim();

  const ev = await getEventByShortId(db, shortId);
  if (!ev) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (ev.closedAt) {
    return NextResponse.json({ error: "Event closed" }, { status: 410 });
  }

  const ok = await bcrypt.compare(rawToken, ev.ingestTokenHash);
  if (!ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    reads?: Array<{ mac?: string; port?: number; ts?: number; seq?: number }>;
  } | null;
  const batch = Array.isArray(body?.reads) ? body!.reads : [];
  if (batch.length === 0) {
    await db
      .update(events)
      .set({ lastIngestAt: new Date() })
      .where(eq(events.id, ev.id));
    return NextResponse.json({ inserted: 0 });
  }
  if (batch.length > MAX_BATCH) {
    return NextResponse.json(
      { error: `Maximum ${MAX_BATCH} reads per batch` },
      { status: 400 },
    );
  }

  if (!checkIngestRate(ev.id, batch.length)) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  const now = new Date();
  const macTotals = new Map<string, number>();
  const portTotals = new Map<string, number>();

  const rows: Array<{
    id: string;
    eventId: string;
    mac: string;
    port: number;
    ts: Date;
    clientSeq: number | null;
  }> = [];

  for (const r of batch) {
    const mac = String(r.mac ?? "")
      .trim()
      .toUpperCase()
      .replace(/[^0-9A-F]/g, "");
    const port = typeof r.port === "number" ? r.port : parseInt(String(r.port), 10);
    if (!mac || mac.length < 4 || !Number.isFinite(port)) continue;
    const ts =
      typeof r.ts === "number" ? parseClientTs(r.ts) : now;
    const pk = `${mac}:${port}`;
    macTotals.set(mac, (macTotals.get(mac) ?? 0) + 1);
    portTotals.set(pk, (portTotals.get(pk) ?? 0) + 1);
    rows.push({
      id: nanoid(),
      eventId: ev.id,
      mac,
      port,
      ts,
      clientSeq: typeof r.seq === "number" ? r.seq : null,
    });
  }

  if (rows.length === 0) {
    return NextResponse.json({ inserted: 0 });
  }

  await db.insert(reads).values(rows);

  for (const [mac, delta] of macTotals) {
    await db
      .insert(macsEvent)
      .values({
        eventId: ev.id,
        mac,
        firstSeen: now,
        lastSeen: now,
        totalReads: delta,
        friendlyName: null,
      })
      .onConflictDoUpdate({
        target: [macsEvent.eventId, macsEvent.mac],
        set: {
          lastSeen: now,
          totalReads: sql`${macsEvent.totalReads} + ${delta}`,
        },
      });
  }

  for (const [pk, delta] of portTotals) {
    const [mac, portStr] = pk.split(":");
    const port = parseInt(portStr, 10);
    await db
      .insert(portsEvent)
      .values({
        eventId: ev.id,
        mac,
        port,
        lastSeen: now,
        totalReads: delta,
      })
      .onConflictDoUpdate({
        target: [portsEvent.eventId, portsEvent.mac, portsEvent.port],
        set: {
          lastSeen: now,
          totalReads: sql`${portsEvent.totalReads} + ${delta}`,
        },
      });
  }

  await db
    .update(events)
    .set({ lastIngestAt: now })
    .where(eq(events.id, ev.id));

  return NextResponse.json({ inserted: rows.length });
}
