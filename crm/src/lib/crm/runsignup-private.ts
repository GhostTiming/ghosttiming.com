import type { RunSignupRace } from "./runsignup";

export type RunSignupProfile = {
  userId: string;
  email: string | null;
  name: string | null;
};

export function isUnpublishedRunSignupRace(race: RunSignupRace) {
  const values = [race.is_private_race, race.private, race.is_draft_race];
  return values.some((value) => {
    const flag = String(value ?? "").trim().toUpperCase();
    return flag === "T" || flag === "TRUE" || flag === "1";
  });
}

export function runSignupRaceMatchesName(race: { name: string }, query: string) {
  const words = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3);
  if (!words.length) return true;
  const name = race.name.toLowerCase();
  return words.every((word) => name.includes(word));
}

export function mergeRunSignupSearchResults(input: {
  publicRaces: RunSignupRace[];
  publicSearchSucceeded: boolean;
  accountRaces: RunSignupRace[];
}) {
  const publicIds = new Set(input.publicRaces.map((race) => String(race.race_id)));
  const merged = new Map<string, { race: RunSignupRace; unpublished: boolean }>();
  for (const race of input.publicRaces) {
    merged.set(String(race.race_id), {
      race,
      unpublished: isUnpublishedRunSignupRace(race),
    });
  }
  for (const race of input.accountRaces) {
    const id = String(race.race_id);
    const unpublished =
      isUnpublishedRunSignupRace(race) ||
      (input.publicSearchSucceeded && !publicIds.has(id));
    const existing = merged.get(id);
    if (!existing) {
      merged.set(id, { race, unpublished });
      continue;
    }
    if (unpublished) existing.unpublished = true;
  }
  return [...merged.values()];
}

function textValue(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export function readRunSignupProfile(payload: unknown): RunSignupProfile | null {
  const candidates: unknown[] = [payload];
  if (payload && typeof payload === "object") {
    const root = payload as Record<string, unknown>;
    if (root.user && typeof root.user === "object") candidates.push(root.user);
    if (Array.isArray(root.users) && root.users[0]) candidates.push(root.users[0]);
  }
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const row = candidate as Record<string, unknown>;
    const userId = textValue(row.user_id ?? row.userId ?? row.sub ?? row.id);
    if (!userId) continue;
    const email = textValue(row.email);
    const first = textValue(row.first_name) ?? "";
    const last = textValue(row.last_name) ?? "";
    const combined = [first, last].filter(Boolean).join(" ");
    return {
      userId,
      email,
      name: combined || textValue(row.name),
    };
  }
  return null;
}

export function profileFromRunSignupAccessToken(accessToken: string) {
  const parts = accessToken.split(".");
  if (parts.length < 2) return null;
  try {
    const json = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as unknown;
    return readRunSignupProfile(json) ?? readRunSignupProfile({ user: json });
  } catch {
    return null;
  }
}
