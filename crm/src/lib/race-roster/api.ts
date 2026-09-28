import { RACE_ROSTER_API_BASE, RaceRosterAuthError } from "./auth";
import type { RaceRosterEvent } from "./types";

export class RaceRosterApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "RaceRosterApiError";
    this.status = status;
  }
}

const RETRY_DELAYS_MS = [1_000, 2_000, 5_000];

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

type DataEnvelope<T> = { data?: T[] | T } | T;

function unwrapData<T>(payload: DataEnvelope<T> | null, label: string): T[] {
  if (payload == null) {
    throw new RaceRosterApiError(`Race Roster ${label} returned an empty body.`, 502);
  }
  if (Array.isArray(payload)) return payload;
  if (typeof payload === "object" && "data" in payload) {
    const data = payload.data;
    if (Array.isArray(data)) return data;
    if (data != null) return [data];
    return [];
  }
  return [payload as T];
}

export async function raceRosterFetch<T>(
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = path.startsWith("http")
    ? path
    : `${RACE_ROSTER_API_BASE}${path.startsWith("/") ? path : `/${path}`}`;

  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });

    if (response.status === 204) return undefined as T;

    const payload = (await response.json().catch(() => null)) as
      | T
      | { error?: string; message?: string; code?: number }
      | null;

    if (response.ok) return payload as T;

    const message =
      payload && typeof payload === "object" && ("message" in payload || "error" in payload)
        ? String(
            ("message" in payload && payload.message) ||
              ("error" in payload && payload.error) ||
              response.statusText,
          )
        : response.statusText;

    if (
      (response.status === 429 || response.status >= 500) &&
      attempt < RETRY_DELAYS_MS.length
    ) {
      await sleep(RETRY_DELAYS_MS[attempt]!);
      continue;
    }

    if (response.status === 401 || response.status === 403) {
      throw new RaceRosterAuthError(
        message || "Race Roster API authorization failed.",
        response.status,
      );
    }

    throw new RaceRosterApiError(
      message || `Race Roster API request failed (${response.status}).`,
      response.status,
    );
  }
}

export async function listRaceRosterEvents(
  accessToken: string,
  options?: { eventIds?: Array<string | number>; lastModifiedDate?: string },
) {
  const params = new URLSearchParams();
  if (options?.eventIds?.length) {
    params.set("eventId", options.eventIds.map(String).join(","));
  }
  if (options?.lastModifiedDate) {
    params.set("lastModifiedDate", options.lastModifiedDate);
  }
  const query = params.toString();
  const payload = await raceRosterFetch<DataEnvelope<RaceRosterEvent>>(
    accessToken,
    `/events${query ? `?${query}` : ""}`,
  );
  return unwrapData(payload, "events list");
}

export async function getRaceRosterEvent(
  accessToken: string,
  eventId: string | number,
) {
  const payload = await raceRosterFetch<DataEnvelope<RaceRosterEvent>>(
    accessToken,
    `/events/${encodeURIComponent(String(eventId))}`,
  );
  const [event] = unwrapData(payload, "event");
  if (!event) {
    throw new RaceRosterApiError(`Race Roster event ${eventId} was not found.`, 404);
  }
  return event;
}
