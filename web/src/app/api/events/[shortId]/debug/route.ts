import { desc, eq, sql } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { macsEvent, portsEvent, reads } from "@/db/schema";
import { requireIngestToken } from "@/lib/ingest-auth";

export const dynamic = "force-dynamic";

/**
 * Debug endpoint for live ingest triage.
 * Auth: Bearer <ingest token> for the event shortId.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { shortId: string } },
) {
  const shortId = params.shortId;
  const auth = await requireIngestToken(
    db,
    shortId,
    req.headers.get("authorization"),
  );
  if ("error" in auth) {
    return auth.error ?? new Response("Unauthorized", { status: 401 });
  }
  const ev = auth.event;

  const [readsCountRow] = await db
    .select({ n: sql<number>`count(*)` })
    .from(reads)
    .where(eq(reads.eventId, ev.id));
  const [portsCountRow] = await db
    .select({ n: sql<number>`count(*)` })
    .from(portsEvent)
    .where(eq(portsEvent.eventId, ev.id));
  const [macsCountRow] = await db
    .select({ n: sql<number>`count(*)` })
    .from(macsEvent)
    .where(eq(macsEvent.eventId, ev.id));

  const latestReads = await db
    .select({
      id: reads.id,
      mac: reads.mac,
      port: reads.port,
      ts: reads.ts,
    })
    .from(reads)
    .where(eq(reads.eventId, ev.id))
    .orderBy(desc(reads.ts))
    .limit(10);

  const latestPorts = await db
    .select({
      mac: portsEvent.mac,
      port: portsEvent.port,
      totalReads: portsEvent.totalReads,
      lastSeen: portsEvent.lastSeen,
    })
    .from(portsEvent)
    .where(eq(portsEvent.eventId, ev.id))
    .orderBy(desc(portsEvent.lastSeen))
    .limit(20);

  return NextResponse.json({
    shortId: ev.shortId,
    eventId: ev.id,
    eventName: ev.name,
    lastIngestAt: ev.lastIngestAt?.toISOString() ?? null,
    counts: {
      reads: Number(readsCountRow?.n ?? 0),
      portsEvent: Number(portsCountRow?.n ?? 0),
      macsEvent: Number(macsCountRow?.n ?? 0),
    },
    latestReads: latestReads.map((r) => ({
      id: r.id,
      mac: r.mac,
      port: r.port,
      ts: r.ts.toISOString(),
    })),
    latestPorts: latestPorts.map((p) => ({
      mac: p.mac,
      port: p.port,
      totalReads: Number(p.totalReads),
      lastSeen: p.lastSeen.toISOString(),
    })),
  });
}

