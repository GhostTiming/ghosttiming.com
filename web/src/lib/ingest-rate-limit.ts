/** Per-instance per-event count in the current UTC second (serverless caveats). */
const perSec = new Map<string, { t: number; c: number }>();

/** 200 sustained + headroom; hard cap 1000 new rows per second per event. */
const MAX_PER_SEC = 1000;

export function checkIngestRate(eventId: string, n: number): boolean {
  const t = Math.floor(Date.now() / 1000);
  let e = perSec.get(eventId);
  if (!e || e.t !== t) {
    e = { t, c: 0 };
  }
  e.c += n;
  perSec.set(eventId, e);
  return e.c <= MAX_PER_SEC;
}
