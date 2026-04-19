import bcrypt from "bcryptjs";
import type { Db } from "@/db";
import { getEventByShortId } from "@/lib/resolve-event";

export async function requireIngestToken(
  db: Db,
  shortId: string,
  authHeader: string | null,
) {
  const ev = await getEventByShortId(db, shortId);
  if (!ev) {
    return { error: new Response("Not found", { status: 404 }) } as const;
  }
  if (!authHeader?.startsWith("Bearer ")) {
    return { error: new Response("Unauthorized", { status: 401 }) } as const;
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    return { error: new Response("Unauthorized", { status: 401 }) } as const;
  }
  const ok = await bcrypt.compare(token, ev.ingestTokenHash);
  if (!ok) {
    return { error: new Response("Unauthorized", { status: 401 }) } as const;
  }
  return { event: ev } as const;
}
