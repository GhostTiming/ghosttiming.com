import type {
  RaceRosterCredentials,
  RaceRosterTokenResponse,
} from "./types";

export const RACE_ROSTER_OAUTH_URL =
  "https://raceroster.com/api/oauth/authorize";
export const RACE_ROSTER_API_BASE = "https://raceroster.com/api/v1";

export class RaceRosterAuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "RaceRosterAuthError";
    this.status = status;
  }
}

type TokenEnvelope =
  | { data?: RaceRosterTokenResponse[] | RaceRosterTokenResponse }
  | RaceRosterTokenResponse;

function unwrapToken(payload: TokenEnvelope | null): RaceRosterTokenResponse {
  if (!payload || typeof payload !== "object") {
    throw new RaceRosterAuthError("Race Roster auth returned an empty body.", 502);
  }
  if ("access_token" in payload && typeof payload.access_token === "string") {
    return payload;
  }
  const data = "data" in payload ? payload.data : undefined;
  const first = Array.isArray(data) ? data[0] : data;
  if (first && typeof first.access_token === "string") {
    return first;
  }
  throw new RaceRosterAuthError(
    "Race Roster auth response did not include an access_token.",
    502,
  );
}

async function postAuthorize(body: URLSearchParams) {
  const response = await fetch(RACE_ROSTER_OAUTH_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const payload = (await response.json().catch(() => null)) as
    | TokenEnvelope
    | { error?: string; error_description?: string; hint?: string }
    | null;

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error_description" in payload
        ? String(payload.error_description || payload.error || response.statusText)
        : response.statusText;
    throw new RaceRosterAuthError(
      message || "Race Roster authorization failed.",
      response.status,
    );
  }

  return unwrapToken(payload as TokenEnvelope);
}

/** Dynamic env reads so Next does not bake empty Race Roster secrets into the bundle. */
function readEnv(name: string, env: NodeJS.Dict<string> = process.env) {
  return env[name]?.trim() || "";
}

export function raceRosterClientConfigured(env: NodeJS.Dict<string> = process.env) {
  return Boolean(readEnv("RACE_ROSTER_CLIENT_ID", env) && readEnv("RACE_ROSTER_CLIENT_SECRET", env));
}

export function readRaceRosterClientFromEnv(env: NodeJS.Dict<string> = process.env) {
  const clientId = readEnv("RACE_ROSTER_CLIENT_ID", env);
  const clientSecret = readEnv("RACE_ROSTER_CLIENT_SECRET", env);
  if (!clientId || !clientSecret) {
    throw new RaceRosterAuthError(
      "Set RACE_ROSTER_CLIENT_ID and RACE_ROSTER_CLIENT_SECRET.",
      400,
    );
  }
  return {
    clientId,
    clientSecret,
    clientName: readEnv("RACE_ROSTER_CLIENT_NAME", env) || undefined,
  };
}

export function readRaceRosterCredentialsFromEnv(
  env: NodeJS.Dict<string> = process.env,
): RaceRosterCredentials {
  const client = readRaceRosterClientFromEnv(env);

  const username = readEnv("RACE_ROSTER_USERNAME", env) || undefined;
  const password = readEnv("RACE_ROSTER_PASSWORD", env) || undefined;
  const refreshToken = readEnv("RACE_ROSTER_REFRESH_TOKEN", env) || undefined;
  if (!refreshToken && (!username || !password)) {
    throw new RaceRosterAuthError(
      "Connect Race Roster in Settings, or set RACE_ROSTER_REFRESH_TOKEN / USERNAME+PASSWORD.",
      400,
    );
  }

  return {
    ...client,
    username,
    password,
    refreshToken,
  };
}

export async function authorizeRaceRoster(
  credentials: RaceRosterCredentials,
): Promise<RaceRosterTokenResponse> {
  if (credentials.refreshToken) {
    try {
      return await postAuthorize(
        new URLSearchParams({
          grant_type: "refresh_token",
          client_id: credentials.clientId,
          client_secret: credentials.clientSecret,
          refresh_token: credentials.refreshToken,
        }),
      );
    } catch (error) {
      if (
        !(error instanceof RaceRosterAuthError) ||
        !credentials.username ||
        !credentials.password
      ) {
        throw error;
      }
      // Fall through to password grant when refresh is expired/invalid.
    }
  }

  if (!credentials.username || !credentials.password) {
    throw new RaceRosterAuthError(
      "Race Roster refresh token failed and no username/password fallback is set.",
      401,
    );
  }

  return postAuthorize(
    new URLSearchParams({
      grant_type: "access_token",
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      username: credentials.username,
      password: credentials.password,
    }),
  );
}
