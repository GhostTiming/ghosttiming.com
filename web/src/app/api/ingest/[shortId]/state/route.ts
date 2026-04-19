import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { events, macsEvent, timerWorkspaces } from "@/db/schema";
import { getEventByShortId } from "@/lib/resolve-event";

export const dynamic = "force-dynamic";

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

  const body = (await req.json().catch(() => ({}))) as {
    eventName?: string;
    macs?: Array<{ mac?: string; friendlyName?: string | null }>;
    workspaces?: Array<{ workspaceId?: string; payload?: unknown }>;
  };

  const now = new Date();

  try {
    const jobs: Promise<unknown>[] = [];

    if (typeof body.eventName === "string") {
      const name = body.eventName.trim().slice(0, 200);
      if (name) {
        jobs.push(
          db.update(events).set({ name }).where(eq(events.id, ev.id)),
        );
      }
    }

    if (Array.isArray(body.macs)) {
      for (const m of body.macs) {
        const mac = String(m.mac ?? "")
          .trim()
          .toUpperCase()
          .replace(/[^0-9A-F]/g, "");
        if (!mac || mac.length < 4) continue;
        const fn =
          typeof m.friendlyName === "string"
            ? m.friendlyName.trim().slice(0, 120)
            : undefined;

        jobs.push(
          db
            .insert(macsEvent)
            .values({
              eventId: ev.id,
              mac,
              friendlyName: fn ?? null,
              firstSeen: now,
              lastSeen: now,
              totalReads: 0,
            })
            .onConflictDoUpdate({
              target: [macsEvent.eventId, macsEvent.mac],
              set:
                fn !== undefined
                  ? {
                      friendlyName: fn || null,
                      lastSeen: now,
                    }
                  : {
                      lastSeen: now,
                    },
            }),
        );
      }
    }

    if (Array.isArray(body.workspaces)) {
      for (const w of body.workspaces) {
        const workspaceId = String(w.workspaceId ?? "")
          .trim()
          .slice(0, 128);
        if (!workspaceId || w.payload === undefined) continue;
        jobs.push(
          db
            .insert(timerWorkspaces)
            .values({
              eventId: ev.id,
              workspaceId,
              payload: w.payload as object,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: [timerWorkspaces.eventId, timerWorkspaces.workspaceId],
              set: {
                payload: w.payload as object,
                updatedAt: now,
              },
            }),
        );
      }
    }

    if (jobs.length > 0) {
      await Promise.all(jobs);
    }

    await db
      .update(events)
      .set({ lastIngestAt: now })
      .where(eq(events.id, ev.id));
  } catch (e) {
    console.error("[ingest/state]", shortId, e);
    return NextResponse.json({ error: "State ingest failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
