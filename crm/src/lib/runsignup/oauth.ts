import { randomBytes } from "node:crypto";
import { readRunSignupProfile } from "@/lib/crm/runsignup-private";
import { createPkcePair, safeOAuthReturnTo } from "@/lib/google/oauth";
import { signOAuthState, verifyOAuthState } from "@/lib/google/token-crypto";

export const RUNSIGNUP_OAUTH_STATE_COOKIE = "gt_runsignup_oauth";
export const RUNSIGNUP_OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;
export const RUNSIGNUP_OAUTH_SCOPE = "rsu_api_read";

const AUTHORIZE_URL = "https://runsignup.com/Profile/OAuth2/RequestGrant";
const TOKEN_URL = "https://runsignup.com/rest/v2/auth/auth-code-redemption.json";
const REFRESH_URL = "https://runsignup.com/rest/v2/auth/refresh-token.json";

export type RunSignupOAuthState = {
  state: string;
  verifier: string;
  returnTo: string;
  createdAt: number;
};

export type RunSignupTokenSet = {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  scope?: string;
  profile: ReturnType<typeof readRunSignupProfile>;
};

function requiredEnv(name: "RUNSIGNUP_OAUTH_CLIENT_ID" | "RUNSIGNUP_OAUTH_CLIENT_SECRET") {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      "RunSignUp sign-in is not configured. Add RUNSIGNUP_OAUTH_CLIENT_ID and RUNSIGNUP_OAUTH_CLIENT_SECRET from https://runsignup.com/Profile/OAuth2/ListClients.",
    );
  }
  return value;
}

export function runSignupOAuthConfigured() {
  return Boolean(
    process.env.RUNSIGNUP_OAUTH_CLIENT_ID?.trim() &&
      process.env.RUNSIGNUP_OAUTH_CLIENT_SECRET?.trim(),
  );
}

export function runSignupOAuthRedirectUri(request: Request) {
  const configured = process.env.RUNSIGNUP_OAUTH_REDIRECT_URI?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const url = new URL(request.url);
  return `${url.origin}/api/runsignup/oauth/callback`;
}

export function buildRunSignupAuthorizeRedirect(input: {
  request: Request;
  returnTo?: string | null;
}) {
  const { verifier, challenge } = createPkcePair();
  const payload: RunSignupOAuthState = {
    state: randomBytes(24).toString("base64url"),
    verifier,
    returnTo: safeOAuthReturnTo(input.returnTo ?? "/settings"),
    createdAt: Date.now(),
  };
  const redirectUri = runSignupOAuthRedirectUri(input.request);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: requiredEnv("RUNSIGNUP_OAUTH_CLIENT_ID"),
    redirect_uri: redirectUri,
    scope: RUNSIGNUP_OAUTH_SCOPE,
    state: payload.state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return {
    cookieValue: signOAuthState(JSON.stringify(payload)),
    authorizeUrl: `${AUTHORIZE_URL}?${params}`,
    redirectUri,
    payload,
  };
}

export function readRunSignupOAuthState(value: string | undefined | null): RunSignupOAuthState {
  if (!value) {
    throw new Error("RunSignUp sign-in expired. Click Connect RunSignUp and try again.");
  }
  let parsed: RunSignupOAuthState;
  try {
    parsed = JSON.parse(verifyOAuthState(value)) as RunSignupOAuthState;
  } catch {
    throw new Error("RunSignUp sign-in expired. Click Connect RunSignUp and try again.");
  }
  if (!parsed?.state || !parsed.verifier) {
    throw new Error("RunSignUp sign-in state was incomplete.");
  }
  if (Date.now() - parsed.createdAt > RUNSIGNUP_OAUTH_STATE_MAX_AGE_SECONDS * 1000) {
    throw new Error("RunSignUp sign-in expired. Click Connect RunSignUp and try again.");
  }
  return parsed;
}

async function runSignupTokenRequest(url: string, body: URLSearchParams): Promise<RunSignupTokenSet> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  const payload = (await response.json().catch(() => null)) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
    error_msg?: string;
  } | null;
  if (!response.ok || !payload?.access_token) {
    throw new Error(
      payload?.error_description ||
        payload?.error_msg ||
        payload?.error ||
        "RunSignUp token exchange failed.",
    );
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresIn: payload.expires_in && payload.expires_in > 0 ? payload.expires_in : 2_592_000,
    scope: payload.scope,
    profile: readRunSignupProfile(payload),
  };
}

export function exchangeRunSignupAuthorizationCode(input: {
  code: string;
  verifier: string;
  redirectUri: string;
}) {
  return runSignupTokenRequest(
    TOKEN_URL,
    new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: requiredEnv("RUNSIGNUP_OAUTH_CLIENT_ID"),
      client_secret: requiredEnv("RUNSIGNUP_OAUTH_CLIENT_SECRET"),
      code_verifier: input.verifier,
    }),
  );
}

export function refreshRunSignupAccessToken(refreshToken: string) {
  return runSignupTokenRequest(
    REFRESH_URL,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: requiredEnv("RUNSIGNUP_OAUTH_CLIENT_ID"),
      client_secret: requiredEnv("RUNSIGNUP_OAUTH_CLIENT_SECRET"),
    }),
  );
}
