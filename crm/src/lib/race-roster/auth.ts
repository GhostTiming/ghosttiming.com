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

export function readRaceRosterCredentialsFromEnv(
  env: NodeJS.Dict<string> = process.env,
): RaceRosterCredentials {
  const clientId = env.RACE_ROSTER_CLIENT_ID?.trim();
  const clientSecret = env.RACE_ROSTER_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new RaceRosterAuthError(
      "Set RACE_ROSTER_CLIENT_ID and RACE_ROSTER_CLIENT_SECRET.",
      400,
    );
  }

  const username = env.RACE_ROSTER_USERNAME?.trim();
  const password = env.RACE_ROSTER_PASSWORD?.trim();
  const refreshToken = env.RACE_ROSTER_REFRESH_TOKEN?.trim();
  if (!refreshToken && (!username || !password)) {
    throw new RaceRosterAuthError(
      "Set RACE_ROSTER_REFRESH_TOKEN, or RACE_ROSTER_USERNAME and RACE_ROSTER_PASSWORD.",
      400,
    );
  }

  return {
    clientId,
    clientSecret,
    username,
    password,
    refreshToken,
    clientName: env.RACE_ROSTER_CLIENT_NAME?.trim(),
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
