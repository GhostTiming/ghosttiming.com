import { and, desc, eq, gt } from "drizzle-orm";
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

  const macRows = await db
    .select()
    .from(macsEvent)
    .where(eq(macsEvent.eventId, eventId));

  const portRows = await db
    .select()
    .from(portsEvent)
    .where(eq(portsEvent.eventId, eventId));

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
