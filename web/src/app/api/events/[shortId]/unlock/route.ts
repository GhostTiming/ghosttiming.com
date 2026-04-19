import bcrypt from "bcryptjs";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { getEventByShortId } from "@/lib/resolve-event";
import { signViewerSession, viewerCookieName } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: { shortId: string } },
) {
  const shortId = params.shortId;
  const body = (await req.json().catch(() => ({}))) as { password?: string };
  const password = body.password ?? "";

  const ev = await getEventByShortId(db, shortId);
  if (!ev) {
    return NextResponse.json({ error: "Unknown event" }, { status: 404 });
  }
  if (ev.closedAt) {
    return NextResponse.json({ error: "Event closed" }, { status: 410 });
  }

  const ok = await bcrypt.compare(password, ev.viewerPasswordHash);
  if (!ok) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const token = await signViewerSession({ eid: ev.id, sid: shortId });
  const name = viewerCookieName(shortId);
  const res = NextResponse.json({ ok: true });
  const isProd = process.env.NODE_ENV === "production";
  res.cookies.set(name, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
