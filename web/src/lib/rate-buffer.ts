/**
 * Rolling per-MAC buffer of (monotonic time, port) for chart + heatmap,
 * aligned with desktop `deque(maxlen=20000)` behavior.
 */
export type PortSample = { t: number; port: string };

const MAX_LEN = 20000;
const WINDOW_SEC = 600 * 2;

export class RateBuffers {
  private byMac = new Map<string, PortSample[]>();
  private refNow = () => performance.now();

  clear() {
    this.byMac.clear();
  }

  /** Align wall-clock read times to the performance timeline using the given anchor. */
  seedFromSnapshot(
    reads: Array<{ mac: string; port: number; ts: string }>,
    anchorWallMs: number = Date.now(),
  ) {
    this.clear();
    const anchorPerf = this.refNow();
    for (const r of reads) {
      const wall = new Date(r.ts).getTime();
      const age = Math.max(0, anchorWallMs - wall);
      const t = anchorPerf - age;
      this.push(r.mac.toUpperCase(), String(r.port), t);
    }
  }

  push(mac: string, port: string, tMono: number) {
    const m = mac.toUpperCase();
    const p = String(port);
    let buf = this.byMac.get(m);
    if (!buf) {
      buf = [];
      this.byMac.set(m, buf);
    }
    buf.push({ t: tMono, port: p });
    while (buf.length > MAX_LEN) buf.shift();
    const cutoff = this.refNow() - WINDOW_SEC;
    while (buf.length && buf[0].t < cutoff) buf.shift();
  }

  prune() {
    const cutoff = this.refNow() - WINDOW_SEC;
    for (const [mac, buf] of this.byMac) {
      while (buf.length && buf[0].t < cutoff) buf.shift();
      if (buf.length === 0) this.byMac.delete(mac);
    }
  }

  get(mac: string): PortSample[] {
    return this.byMac.get(mac.toUpperCase()) ?? [];
  }

  allMacs(): string[] {
    return [...this.byMac.keys()];
  }
}
