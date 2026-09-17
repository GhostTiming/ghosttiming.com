import { createHash } from "node:crypto";

import type { RaceRosterEvent } from "./types";

/**
 * Race Roster public URLs look like:
 * https://raceroster.com/events/{year}/{numericId}/{slug}
 */
export function parseRaceRosterUrl(url?: string | null) {
  if (!url?.trim()) return null;
  try {
    const parsed = new URL(url.trim());
    const match = parsed.pathname.match(
      /\/events\/(\d{4})\/(\d+)(?:\/([^/?#]+))?/i,
    );
    if (!match) return null;
    return {
      year: Number(match[1]),
      numericId: Number(match[2]),
      slugPart: match[3] ? decodeURIComponent(match[3]) : null,
    };
  } catch {
    return null;
  }
}

export function stablePositiveInt(seed: string, max = 2_000_000_000) {
  const digest = createHash("sha256").update(seed).digest();
  const value = digest.readUInt32BE(0) % max;
  return value === 0 ? 1 : value;
}

/**
 * Prefer the numeric ID from the public event URL. Fall back to a stable hash of
 * the opaque API eventId so catalog.source_race_id stays an integer.
 */
export function resolveRaceRosterNumericId(event: RaceRosterEvent) {
  const fromUrl = parseRaceRosterUrl(event.url);
  if (fromUrl?.numericId && Number.isFinite(fromUrl.numericId)) {
    return fromUrl.numericId;
  }
  return stablePositiveInt(`race_roster:event:${String(event.eventId)}`);
}

export function resolveRaceRosterSubEventId(
  subEventId: number | string,
  sourceRaceId: number,
) {
  const numeric = Number(subEventId);
  if (Number.isFinite(numeric) && numeric > 0 && Number.isInteger(numeric)) {
    return numeric;
  }
  return stablePositiveInt(
    `race_roster:subevent:${sourceRaceId}:${String(subEventId)}`,
  );
}

export function slugifyRaceRosterName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function buildRaceRosterSlug(event: RaceRosterEvent, sourceRaceId: number) {
  const fromUrl = parseRaceRosterUrl(event.url)?.slugPart;
  const base =
    (fromUrl && slugifyRaceRosterName(fromUrl)) ||
    slugifyRaceRosterName(event.name) ||
    "race";
  return `${base}-rr-${sourceRaceId}`;
}
