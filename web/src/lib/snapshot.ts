import { and, desc, eq, gt, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { macsEvent, portsEvent, reads, timerWorkspaces, events } from "@/db/schema";

export type SnapshotRow = {
  eventId: string;
  shortId: string;
  name: string;
  gateTime: string | null;
  macs: Array<{
    mac: string;
    friendlyName: string | null;
    firstSeen: string;
    lastSeen: string;
    totalReads: number;
  }>;
  ports: Array<{
    mac: string;
    port: number;
    lastSeen: string;
    totalReads: number;
  }>;
  workspaces: Array<{
    workspaceId: string;
    payload: unknown;
    updatedAt: string;
  }>;
  recentReads: Array<{
    mac: string;
    port: number;
    ts: string;
    id: string;
  }>;
};

export async function buildSnapshot(
  db: Db,
  eventId: string,
  shortId: string,
  recentSeconds = 600,
): Promise<SnapshotRow> {
  const [ev] = await db
    .select()
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  const name = ev?.name ?? "Untitled event";

  let macRows = await db
    .select()
    .from(macsEvent)
    .where(eq(macsEvent.eventId, eventId));

  let portRows = await db
    .select()
    .from(portsEvent)
    .where(eq(portsEvent.eventId, eventId));

  // Fallback: if aggregate tables are empty/stale, derive mats from raw reads so
  // the viewer still shows live rows instead of "No antenna rows yet".
  if (portRows.length === 0) {
    const portAgg = await db
      .select({
        mac: reads.mac,
        port: reads.port,
        lastSeen: sql<Date>`max(${reads.ts})`,
        totalReads: sql<number>`count(*)`,
      })
      .from(reads)
      .where(eq(reads.eventId, eventId))
      .groupBy(reads.mac, reads.port);

    portRows = portAgg.map((p) => ({
      eventId,
      mac: p.mac,
      port: Number(p.port),
      lastSeen: p.lastSeen instanceof Date ? p.lastSeen : new Date(p.lastSeen),
      totalReads: Number(p.totalReads),
    }));
  }

  if (macRows.length === 0) {
    const macAgg = await db
      .select({
        mac: reads.mac,
        firstSeen: sql<Date>`min(${reads.ts})`,
        lastSeen: sql<Date>`max(${reads.ts})`,
        totalReads: sql<number>`count(*)`,
      })
      .from(reads)
      .where(eq(reads.eventId, eventId))
      .groupBy(reads.mac);

    macRows = macAgg.map((m) => ({
      eventId,
      mac: m.mac,
      friendlyName: null,
      firstSeen: m.firstSeen instanceof Date ? m.firstSeen : new Date(m.firstSeen),
      lastSeen: m.lastSeen instanceof Date ? m.lastSeen : new Date(m.lastSeen),
      totalReads: Number(m.totalReads),
    }));
  }

  const wsRows = await db
    .select()
    .from(timerWorkspaces)
    .where(eq(timerWorkspaces.eventId, eventId));

  const since = new Date(Date.now() - recentSeconds * 1000);
  const readRows = await db
    .select({
      id: reads.id,
      mac: reads.mac,
      port: reads.port,
      ts: reads.ts,
    })
    .from(reads)
    .where(and(eq(reads.eventId, eventId), gt(reads.ts, since)))
    .orderBy(desc(reads.ts))
    .limit(50000);

  return {
    eventId,
    shortId,
    name,
    gateTime: null,
    macs: macRows.map((m) => ({
      mac: m.mac,
      friendlyName: m.friendlyName,
      firstSeen: m.firstSeen.toISOString(),
      lastSeen: m.lastSeen.toISOString(),
      totalReads: Number(m.totalReads),
    })),
    ports: portRows.map((p) => ({
      mac: p.mac,
      port: p.port,
      lastSeen: p.lastSeen.toISOString(),
      totalReads: Number(p.totalReads),
    })),
    workspaces: wsRows.map((w) => ({
      workspaceId: w.workspaceId,
      payload: w.payload,
      updatedAt: w.updatedAt.toISOString(),
    })),
    recentReads: readRows.map((r) => ({
      id: r.id,
      mac: r.mac,
      port: r.port,
      ts: r.ts.toISOString(),
    })),
  };
}
