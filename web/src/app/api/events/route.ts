import { customAlphabet, nanoid } from "nanoid";
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { creationIpHour, events } from "@/db/schema";
import { hashIpForRateLimit } from "@/lib/ip-hash";
import { requireCreationAllowed } from "@/lib/requireCreationAllowed";

const shortIdAlphabet = customAlphabet(
  "0123456789abcdefghijklmnopqrstuvwxyz",
  10,
);
const BCRYPT_ROUNDS = 12;
const MAX_EVENTS_PER_IP_HOUR = 20;

function clientIp(req: NextRequest) {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    await requireCreationAllowed(req);
  } catch {
    return NextResponse.json({ error: "Creation not allowed" }, { status: 403 });
  }

  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Server misconfiguration: SESSION_SECRET" },
      { status: 500 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { name?: string };
  const name = (body.name || "Untitled event").trim().slice(0, 200) || "Untitled event";

  const hourBucket = new Date();
  hourBucket.setUTCMinutes(0, 0, 0);
  const ipHash = hashIpForRateLimit(clientIp(req), secret);

  const [up] = await db
    .insert(creationIpHour)
    .values({ ipHash, hourBucket, count: 1 })
    .onConflictDoUpdate({
      target: [creationIpHour.ipHash, creationIpHour.hourBucket],
      set: { count: sql`${creationIpHour.count} + 1` },
    })
    .returning({ count: creationIpHour.count });

  if (up && up.count > MAX_EVENTS_PER_IP_HOUR) {
    return NextResponse.json(
      { error: "Too many events created from this network. Try again later." },
      { status: 429 },
    );
  }

  const ingestToken = nanoid(32);
  const viewerPassword = nanoid(10);
  const ingestTokenHash = await bcrypt.hash(ingestToken, BCRYPT_ROUNDS);
  const viewerPasswordHash = await bcrypt.hash(viewerPassword, BCRYPT_ROUNDS);

  for (let attempt = 0; attempt < 8; attempt++) {
    const shortId = shortIdAlphabet();
    try {
      const [row] = await db
        .insert(events)
        .values({
          shortId,
          name,
          ingestTokenHash,
          viewerPasswordHash,
        })
        .returning({ id: events.id, shortId: events.shortId });
      if (!row) continue;
      const base =
        process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "";
      const shareUrl = base
        ? `${base}/e/${row.shortId}`
        : `/e/${row.shortId}`;

      return NextResponse.json({
        eventId: row.id,
        shortId: row.shortId,
        ingestToken,
        viewerPassword,
        shareUrl,
        name,
      });
    } catch {
      // shortId collision — retry
    }
  }
  return NextResponse.json(
    { error: "Could not allocate a unique id" },
    { status: 500 },
  );
}
