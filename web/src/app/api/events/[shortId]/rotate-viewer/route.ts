import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { events } from "@/db/schema";
import { getEventByShortId } from "@/lib/resolve-event";

export const dynamic = "force-dynamic";

const BCRYPT_ROUNDS = 12;

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

  const ok = await bcrypt.compare(rawToken, ev.ingestTokenHash);
  if (!ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    viewerPassword?: string;
  };
  const custom = (body?.viewerPassword ?? "").trim();
  if (custom.length > 0) {
    if (custom.length < 4 || custom.length > 256) {
      return NextResponse.json(
        { error: "viewerPassword must be 4–256 characters, or omit for a random one" },
        { status: 400 },
      );
    }
  }
  const viewerPassword = custom.length > 0 ? custom : nanoid(10);
  const viewerPasswordHash = await bcrypt.hash(viewerPassword, BCRYPT_ROUNDS);

  await db
    .update(events)
    .set({ viewerPasswordHash })
    .where(eq(events.id, ev.id));

  return NextResponse.json({ viewerPassword });
}
