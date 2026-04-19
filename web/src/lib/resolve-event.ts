import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import type { Db } from "@/db";
import { events } from "@/db/schema";
import { verifyViewerSession, viewerCookieName } from "@/lib/session";

export async function getEventByShortId(db: Db, shortId: string) {
  const [ev] = await db
    .select()
    .from(events)
    .where(eq(events.shortId, shortId))
    .limit(1);
  return ev ?? null;
}

export async function requireViewerAuth(
  db: Db,
  req: NextRequest,
  shortId: string,
) {
  const cookie = req.cookies.get(viewerCookieName(shortId))?.value;
  const sess = await verifyViewerSession(cookie);
  if (!sess || sess.sid !== shortId) {
    return { error: new Response("Unauthorized", { status: 401 }) } as const;
  }
  const [ev] = await db
    .select()
    .from(events)
    .where(eq(events.id, sess.eid))
    .limit(1);
  if (!ev || ev.shortId !== shortId) {
    return { error: new Response("Unauthorized", { status: 401 }) } as const;
  }
  if (ev.closedAt) {
    return { error: new Response("Event closed", { status: 410 }) } as const;
  }
  return { event: ev } as const;
}
