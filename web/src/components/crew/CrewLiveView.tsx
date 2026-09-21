"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { CrewIndexEvent, CrewSnapshot } from "@/lib/crew-auth";

const STALE_AFTER_SEC = 15;

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(1, ...values);
  const w = 88;
  const h = 36;
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const points = values
    .map((v, i) => {
      const x = i * step;
      const y = h - (v / max) * (h - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2"
        points={points || `0,${h - 2}`}
      />
    </svg>
  );
}

function PortTile({
  port,
}: {
  port: CrewSnapshot["devices"][number]["ports"][number];
}) {
  return (
    <div
      className="flex h-[72px] w-[72px] flex-col items-center justify-center rounded-md text-white shadow-sm"
      style={{ background: port.color }}
    >
      <div className="text-[10px] uppercase tracking-wide opacity-80">P{port.port}</div>
      <div className="text-lg font-semibold leading-none">
        {port.count.toLocaleString()}
      </div>
      <div className="text-xs tabular-nums">{port.elapsed}</div>
    </div>
  );
}

export function CrewLiveView() {
  const router = useRouter();
  const [events, setEvents] = useState<CrewIndexEvent[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [snapshot, setSnapshot] = useState<CrewSnapshot | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now() / 1000);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const indexRes = await fetch("/api/crew/live/index", {
          credentials: "include",
          cache: "no-store",
        });
        if (indexRes.status === 401) {
          router.replace("/crew/live/login");
          return;
        }
        if (!indexRes.ok) {
          throw new Error("Could not load active events.");
        }
        const index = (await indexRes.json()) as { events?: CrewIndexEvent[] };
        const nextEvents = Array.isArray(index.events) ? index.events : [];
        if (cancelled) return;
        setEvents(nextEvents);
        setSelectedId((current) => {
          if (current && nextEvents.some((ev) => ev.event_id === current)) {
            return current;
          }
          return nextEvents[0]?.event_id ?? "";
        });
        setError("");
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Live feed unavailable.");
        }
      }
      setNow(Date.now() / 1000);
    }
    void tick();
    const id = window.setInterval(() => void tick(), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [router]);

  useEffect(() => {
    if (!selectedId) {
      setSnapshot(null);
      return;
    }
    let cancelled = false;
    async function load() {
      const res = await fetch(
        `/api/crew/live/snapshot?event_id=${encodeURIComponent(selectedId)}`,
        { credentials: "include", cache: "no-store" },
      );
      if (res.status === 401) {
        router.replace("/crew/live/login");
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as CrewSnapshot;
      if (!cancelled) setSnapshot(data);
    }
    void load();
    const id = window.setInterval(() => void load(), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [selectedId, router]);

  const stale = useMemo(() => {
    if (!snapshot || snapshot.status !== "live") return false;
    return now - snapshot.updated_at > STALE_AFTER_SEC;
  }, [now, snapshot]);

  async function logout() {
    await fetch("/api/crew/live/logout", { method: "POST", credentials: "include" });
    router.replace("/crew/live/login");
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-[1400px] flex-col gap-4 px-4 py-5">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-muted">Ghost Timing</p>
          <h1 className="text-2xl font-semibold">Crew live</h1>
        </div>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
          <label className="flex w-full flex-col text-sm text-muted sm:w-auto">
            Your event
            <select
              className="mt-1 min-h-12 w-full rounded-md border border-border bg-card px-3 py-3 text-lg text-foreground sm:min-w-[260px]"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              {events.length === 0 ? (
                <option value="">No active events</option>
              ) : (
                events.map((ev) => (
                  <option key={ev.event_id} value={ev.event_id}>
                    {ev.event_name}
                    {ev.status === "ended" ? " (ended)" : ""}
                  </option>
                ))
              )}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void logout()}
            className="rounded-md border border-border px-3 py-2 text-sm text-muted hover:text-foreground"
          >
            Sign out
          </button>
        </div>
      </header>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      {!snapshot ? (
        <p className="text-muted">
          Waiting for Chip Streamer to publish a 1-second analytics snapshot.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
            <span
              className={
                snapshot.status === "ended" || stale
                  ? "rounded bg-red-900/40 px-2 py-1 text-red-200"
                  : "rounded bg-emerald-900/40 px-2 py-1 text-emerald-200"
              }
            >
              {snapshot.status === "ended"
                ? "Stream ended"
                : stale
                  ? "Stale — laptop may be offline"
                  : "Live"}
            </span>
            {snapshot.distance_key ? <span>Longest race: {snapshot.distance_key}</span> : null}
            {snapshot.gate_time ? <span>Gate {snapshot.gate_time}</span> : null}
            <span>{snapshot.devices.length} device(s)</span>
          </div>
          <div className="flex flex-col gap-3">
            {snapshot.devices.map((device) => (
              <section
                key={device.mac}
                className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-card p-3"
              >
                <div
                  className="h-10 w-10 rounded-md"
                  style={{ background: device.color }}
                  aria-hidden
                />
                <div className="min-w-[180px]">
                  <div className="font-semibold">{device.label}</div>
                  <div className="text-sm text-muted">
                    {device.location || "No location"} · {device.read_count.toLocaleString()} reads
                  </div>
                </div>
                <Sparkline values={device.sparkline} color={device.color} />
                <div className="flex flex-wrap gap-2">
                  {device.ports.length === 0 ? (
                    <span className="text-sm text-muted">No ports yet</span>
                  ) : (
                    device.ports.map((port) => <PortTile key={port.port} port={port} />)
                  )}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
