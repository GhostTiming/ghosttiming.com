import { and, asc, eq, gt } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { reads } from "@/db/schema";
import { buildSnapshot } from "@/lib/snapshot";
import { requireViewerAuth } from "@/lib/resolve-event";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { shortId: string } },
) {
  const shortId = params.shortId;
  const auth = await requireViewerAuth(db, req, shortId);
  if ("error" in auth) return auth.error;

  const eventId = auth.event.id;
  const snap = await buildSnapshot(db, eventId, shortId, 600);

  const wmStart =
    snap.recentReads.length > 0
      ? new Date(
          Math.max(
            ...snap.recentReads.map((r) => new Date(r.ts).getTime()),
          ),
        )
      : new Date(Date.now() - 2000);

  let wm = wmStart;

  const lastEventId = req.headers.get("last-event-id");
  if (lastEventId) {
    const d = new Date(lastEventId);
    if (!isNaN(d.getTime())) {
      wm = d;
    }
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown, id?: string) => {
        let b = "";
        if (id) b += `id: ${id}\n`;
        b += `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(b));
      };

      send("snapshot", snap, wm.toISOString());

      const poll = async () => {
        try {
          const rows = await db
            .select({
              id: reads.id,
              mac: reads.mac,
              port: reads.port,
              ts: reads.ts,
            })
            .from(reads)
            .where(and(eq(reads.eventId, eventId), gt(reads.ts, wm)))
            .orderBy(asc(reads.ts))
            .limit(8000);

          if (rows.length > 0) {
            const maxTs = rows.reduce(
              (m, r) => (r.ts > m ? r.ts : m),
              rows[0].ts,
            );
            wm = maxTs;
            send(
              "reads",
              {
                reads: rows.map((r) => ({
                  id: r.id,
                  mac: r.mac,
                  port: r.port,
                  ts: r.ts.toISOString(),
                })),
              },
              wm.toISOString(),
            );
          }
        } catch (e) {
          controller.error(e as Error);
        }
      };

      const iv = setInterval(() => {
        void poll();
      }, 500);

      req.signal.addEventListener("abort", () => {
        clearInterval(iv);
        try {
          controller.close();
        } catch {
          /* closed */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
