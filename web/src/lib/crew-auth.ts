import { createHash, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { CREW_COOKIE, verifyCrewSession } from "@/lib/crew-session";

const MAX_SNAPSHOT_BYTES = 256_000;
const MAX_DEVICES = 200;
const MAX_PORTS = 32;
const MAX_SPARKLINE = 80;

export function secretsConfigured(): { password: boolean; writeToken: boolean } {
  return {
    password: Boolean(process.env.CREW_LIVE_PASSWORD),
    writeToken: Boolean(process.env.CREW_LIVE_WRITE_TOKEN),
  };
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function safeEqualSecret(provided: string, expected: string): boolean {
  const left = sha256(provided);
  const right = sha256(expected);
  return timingSafeEqual(left, right);
}

export function verifyCrewPassword(password: string): boolean {
  const expected = process.env.CREW_LIVE_PASSWORD ?? "";
  if (!expected) return false;
  return safeEqualSecret(password, expected);
}

export function verifyCrewWriteToken(authHeader: string | null): boolean {
  const expected = process.env.CREW_LIVE_WRITE_TOKEN ?? "";
  if (!expected) return false;
  if (!authHeader?.startsWith("Bearer ")) return false;
  const token = authHeader.slice(7).trim();
  if (!token) return false;
  return safeEqualSecret(token, expected);
}

export async function requireCrewCookie() {
  const token = cookies().get(CREW_COOKIE)?.value;
  const sess = await verifyCrewSession(token);
  return Boolean(sess);
}

export async function requireCrewRequest(req: NextRequest) {
  const token = req.cookies.get(CREW_COOKIE)?.value;
  return Boolean(await verifyCrewSession(token));
}

export type CrewIndexEvent = {
  event_id: string;
  event_name: string;
  status: "live" | "ended";
  updated_at: number;
};

export type CrewSnapshot = {
  schema: number;
  event_id: string;
  event_name: string;
  updated_at: number;
  status: "live" | "ended";
  distance_key?: string;
  distance_miles?: number;
  gate_time?: string;
  start_at?: number | null;
  cutoff_at?: number | null;
  devices: Array<{
    mac: string;
    label: string;
    location: string;
    color: string;
    read_count: number;
    sparkline: number[];
    ports: Array<{
      port: string;
      count: number;
      elapsed_sec: number | null;
      elapsed: string;
      color: string;
    }>;
  }>;
};

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function sanitizeCrewSnapshot(raw: unknown): CrewSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as Record<string, unknown>;
  const eventId = String(body.event_id ?? "").trim();
  const eventName = String(body.event_name ?? "").trim().slice(0, 120);
  if (!/^[0-9a-fA-F-]{8,64}$/.test(eventId) || !eventName) return null;
  const status = body.status === "ended" ? "ended" : "live";
  const updatedAt = asFiniteNumber(body.updated_at) ?? Date.now() / 1000;
  const devicesIn = Array.isArray(body.devices) ? body.devices.slice(0, MAX_DEVICES) : [];
  const devices: CrewSnapshot["devices"] = [];
  for (const item of devicesIn) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const mac = String(row.mac ?? "")
      .trim()
      .toUpperCase()
      .replace(/[^0-9A-Z]/g, "")
      .slice(0, 32);
    if (mac.length < 4) continue;
    const portsIn = Array.isArray(row.ports) ? row.ports.slice(0, MAX_PORTS) : [];
    const ports: CrewSnapshot["devices"][number]["ports"] = [];
    for (const portItem of portsIn) {
      if (!portItem || typeof portItem !== "object") continue;
      const portRow = portItem as Record<string, unknown>;
      const port = String(portRow.port ?? "").trim().slice(0, 8);
      const count = Math.max(0, Math.floor(asFiniteNumber(portRow.count) ?? 0));
      if (!port) continue;
      const elapsedSec = asFiniteNumber(portRow.elapsed_sec);
      ports.push({
        port,
        count,
        elapsed_sec: elapsedSec,
        elapsed: String(portRow.elapsed ?? "—").slice(0, 12),
        color: String(portRow.color ?? "#616161").slice(0, 16),
      });
    }
    const sparkline = Array.isArray(row.sparkline)
      ? row.sparkline
          .slice(0, MAX_SPARKLINE)
          .map((n) => Math.max(0, Math.floor(asFiniteNumber(n) ?? 0)))
      : [];
    devices.push({
      mac,
      label: String(row.label ?? mac).slice(0, 80),
      location: String(row.location ?? "").slice(0, 80),
      color: String(row.color ?? "#3366cc").slice(0, 16),
      read_count: Math.max(0, Math.floor(asFiniteNumber(row.read_count) ?? 0)),
      sparkline,
      ports,
    });
  }
  return {
    schema: 1,
    event_id: eventId,
    event_name: eventName,
    updated_at: updatedAt,
    status,
    distance_key: String(body.distance_key ?? "").slice(0, 32) || undefined,
    distance_miles: asFiniteNumber(body.distance_miles) ?? undefined,
    gate_time: String(body.gate_time ?? "").slice(0, 16) || undefined,
    start_at: asFiniteNumber(body.start_at),
    cutoff_at: asFiniteNumber(body.cutoff_at),
    devices,
  };
}

export function sanitizeCrewIndex(raw: unknown): { schema: 1; updated_at: number; events: CrewIndexEvent[] } | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as Record<string, unknown>;
  const eventsIn = Array.isArray(body.events) ? body.events.slice(0, 20) : [];
  const events: CrewIndexEvent[] = [];
  for (const item of eventsIn) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const eventId = String(row.event_id ?? "").trim();
    const eventName = String(row.event_name ?? "").trim().slice(0, 120);
    if (!/^[0-9a-fA-F-]{8,64}$/.test(eventId) || !eventName) continue;
    events.push({
      event_id: eventId,
      event_name: eventName,
      status: row.status === "ended" ? "ended" : "live",
      updated_at: asFiniteNumber(row.updated_at) ?? Date.now() / 1000,
    });
  }
  return {
    schema: 1,
    updated_at: asFiniteNumber(body.updated_at) ?? Date.now() / 1000,
    events,
  };
}

export function snapshotByteLimitExceeded(raw: unknown): boolean {
  try {
    return Buffer.byteLength(JSON.stringify(raw), "utf8") > MAX_SNAPSHOT_BYTES;
  } catch {
    return true;
  }
}
