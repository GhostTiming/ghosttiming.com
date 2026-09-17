export type RunSignupAddress = {
  street?: string | null;
  street2?: string | null;
  city?: string | null;
  state?: string | null;
  zipcode?: string | null;
};

export type RunSignupEvent = {
  event_id?: number | string;
  name?: string | null;
  start_time?: string | null;
  distance?: string | null;
  volunteer?: string | null;
  event_type?: string | null;
};

export type RunSignupRace = {
  race_id: number | string;
  name: string;
  next_date?: string | null;
  url?: string | null;
  external_race_url?: string | null;
  timezone?: string | null;
  logo_url?: string | null;
  description?: string | null;
  address?: RunSignupAddress | null;
  events?: RunSignupEvent[] | null;
};

export {
  RUNSIGNUP_LISTING_PREFIX,
  looksLikeEventUrl,
  parseRaceRosterUrl,
  parseRunSignupDistance,
  parseRunSignupListingId,
  parseRunSignupLocalDateTime,
  parseRunSignupUrl,
  runSignupListingId,
  shouldSearchOnlineListings,
  type ParsedRaceRosterUrl,
  type ParsedRunSignupUrl,
} from "./runsignup-parse";

import {
  parseRunSignupLocalDateTime,
} from "./runsignup-parse";

function unwrapRace(payload: unknown): RunSignupRace | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as { race?: RunSignupRace; races?: Array<{ race?: RunSignupRace }> };
  if (root.race?.race_id && root.race.name) return root.race;
  const nested = root.races?.[0]?.race;
  if (nested?.race_id && nested.name) return nested;
  return null;
}

async function runSignupGet(path: string, params: Record<string, string>) {
  const url = new URL(`https://runsignup.com/Rest/${path.replace(/^\//, "")}`);
  url.searchParams.set("format", "json");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const apiKey = process.env.RUNSIGNUP_API_KEY;
  const apiSecret = process.env.RUNSIGNUP_API_SECRET;
  if (apiKey) url.searchParams.set("api_key", apiKey);
  if (apiSecret) url.searchParams.set("api_secret", apiSecret);
  const headers: Record<string, string> = { Accept: "application/json" };
  const caller = process.env.RUNSIGNUP_API_REG;
  const callerSecret = process.env.RUNSIGNUP_API_REG_SECRET;
  if (caller) url.searchParams.set("rsu_api_reg", caller);
  if (callerSecret) headers["X-RSU-API-REG-SECRET"] = callerSecret;
  const response = await fetch(url, {
    headers,
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`RunSignUp request failed (${response.status}).`);
  }
  return response.json() as Promise<unknown>;
}

export async function fetchRunSignupRace(raceId: string) {
  const payload = await runSignupGet(`race/${encodeURIComponent(raceId)}`, {
    events: "T",
  });
  return unwrapRace(payload);
}

export async function searchRunSignupRaces(name: string, limit = 12) {
  const payload = await runSignupGet("races", {
    name: name.trim().slice(0, 120),
    events: "T",
    results_per_page: String(Math.min(Math.max(limit, 1), 25)),
    page: "1",
    sort: "date ASC",
  });
  if (!payload || typeof payload !== "object") return [];
  const rows = (payload as { races?: Array<{ race?: RunSignupRace }> }).races ?? [];
  return rows
    .map((row) => row.race)
    .filter((race): race is RunSignupRace => Boolean(race?.race_id && race.name));
}

export function currentRunSignupEvents(race: RunSignupRace) {
  const events = race.events ?? [];
  const next = parseRunSignupLocalDateTime(race.next_date);
  const future = events.filter((event) => {
    if (String(event.volunteer ?? "F").toUpperCase() === "T") return false;
    if (String(event.event_type ?? "").toLowerCase().includes("virtual")) {
      return false;
    }
    const start = parseRunSignupLocalDateTime(event.start_time);
    if (!start) return false;
    if (next && start.year !== next.year) return false;
    return start.year >= new Date().getFullYear() - 1;
  });
  return future.length ? future : events.filter((event) => {
    const start = parseRunSignupLocalDateTime(event.start_time);
    return start && (!next || start.year === next.year);
  });
}

export function earliestRunSignupStart(race: RunSignupRace) {
  const times = currentRunSignupEvents(race)
    .map((event) => parseRunSignupLocalDateTime(event.start_time))
    .filter((value): value is NonNullable<typeof value> => Boolean(value))
    .sort((left, right) => left.local.localeCompare(right.local));
  return times[0] ?? parseRunSignupLocalDateTime(race.next_date);
}
