import { and, asc, eq, gt } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "@/db";
import { reads } from "@/db/schema";
import { buildSnapshot } from "@/lib/snapshot";
import { requireViewerAuth } from "@/lib/resolve-event";

export const runtime = "edge";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const POLL_FAST_MS = 500;
const POLL_SLOW_MS = 1500;
const EMPTY_TICKS_BEFORE_SLOW = 10;
const PING_EVERY_MS = 25_000;

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
          Math.max(...snap.recentReads.map((r) => new Date(r.ts).getTime())),
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
      let closed = false;
      let emptyTicks = 0;
      let pollTimer: ReturnType<typeof setTimeout> | null = null;
      let pingTimer: ReturnType<typeof setInterval> | null = null;

      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      const send = (event: string, data: unknown, id?: string) => {
        let b = "";
        if (id) b += `id: ${id}\n`;
        b += `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        safeEnqueue(b);
      };

      send("snapshot", snap, wm.toISOString());
      safeEnqueue(": hello\n\n");

      const schedulePoll = () => {
        if (closed) return;
        const delay =
          emptyTicks >= EMPTY_TICKS_BEFORE_SLOW ? POLL_SLOW_MS : POLL_FAST_MS;
        pollTimer = setTimeout(() => {
          void poll();
        }, delay);
      };

      const poll = async () => {
        if (closed) return;
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
            emptyTicks = 0;
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
          } else {
            emptyTicks = Math.min(emptyTicks + 1, 60);
          }
        } catch (e) {
          console.error("[stream/poll]", shortId, e);
        } finally {
          schedulePoll();
        }
      };

      schedulePoll();

      pingTimer = setInterval(() => {
        safeEnqueue(`: ping ${Date.now()}\n\n`);
      }, PING_EVERY_MS);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (pollTimer) clearTimeout(pollTimer);
        if (pingTimer) clearInterval(pingTimer);
        try {
          controller.close();
        } catch {
          /* closed */
        }
      };

      req.signal.addEventListener("abort", cleanup);
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
