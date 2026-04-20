import { and, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { events } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const isProd = process.env.NODE_ENV === "production";

  if (isProd && !secret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 503 },
    );
  }
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const idleClosed = await db
    .update(events)
    .set({ closedAt: sql`now()` })
    .where(
      and(
        isNull(events.closedAt),
        isNotNull(events.lastIngestAt),
        lt(events.lastIngestAt, sql`now() - interval '24 hours'`),
      ),
    )
    .returning({ id: events.id });

  const deletedOld = await db
    .delete(events)
    .where(
      and(
        isNotNull(events.closedAt),
        lt(events.closedAt, sql`now() - interval '7 days'`),
      ),
    )
    .returning({ id: events.id });

  return NextResponse.json({
    idleClosed: idleClosed.length,
    deletedOld: deletedOld.length,
  });
}
