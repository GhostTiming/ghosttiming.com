import { createHash, randomBytes } from "node:crypto";
import { GOOGLE_SCOPE_STRING } from "./scopes";
import { signOAuthState, verifyOAuthState } from "./token-crypto";

export const GOOGLE_OAUTH_STATE_COOKIE = "gt_google_oauth";
export const GOOGLE_OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;

export type GoogleOAuthState = {
  state: string;
  verifier: string;
  returnTo: string;
  addAccount: boolean;
  createdAt: number;
};

export type GoogleTokenSet = {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  scope?: string;
};

function requiredEnv(name: "NEXT_PUBLIC_GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET") {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is not set. Add the Google OAuth web client ${name === "GOOGLE_CLIENT_SECRET" ? "secret" : "ID"} to the server environment.`,
    );
  }
  return value;
}

export function googleOAuthClientId() {
  return requiredEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID");
}

export function googleOAuthClientSecret() {
  return requiredEnv("GOOGLE_CLIENT_SECRET");
}

export function assertGoogleOAuthServerConfig() {
  googleOAuthClientId();
  googleOAuthClientSecret();
}

export function googleOAuthRedirectUri(request: Request) {
  const configured = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const url = new URL(request.url);
  return `${url.origin}/api/google/oauth/callback`;
}

export function safeOAuthReturnTo(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("://")) {
    return "/dashboard";
  }
  return value;
}

export function createPkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function buildGoogleAuthorizeRedirect(input: {
  request: Request;
  returnTo?: string | null;
  addAccount?: boolean;
  loginHint?: string | null;
}) {
  const { verifier, challenge } = createPkcePair();
  const payload: GoogleOAuthState = {
    state: randomBytes(24).toString("base64url"),
    verifier,
    returnTo: safeOAuthReturnTo(input.returnTo),
    addAccount: Boolean(input.addAccount),
    createdAt: Date.now(),
  };
  const redirectUri = googleOAuthRedirectUri(input.request);
  const params = new URLSearchParams({
    client_id: googleOAuthClientId(),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPE_STRING,
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: input.addAccount ? "select_account consent" : "consent",
    state: payload.state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  if (input.loginHint && !input.addAccount) params.set("login_hint", input.loginHint);
  return {
    cookieValue: signOAuthState(JSON.stringify(payload)),
    authorizeUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
    redirectUri,
    payload,
  };
}

export function readOAuthStateCookie(value: string | undefined | null): GoogleOAuthState {
  if (!value) throw new Error("Google sign-in expired. Click Connect Google and try again.");
  const parsed = JSON.parse(verifyOAuthState(value)) as GoogleOAuthState;
  if (!parsed?.state || !parsed.verifier) {
    throw new Error("Google sign-in state was incomplete.");
  }
  if (Date.now() - parsed.createdAt > GOOGLE_OAUTH_STATE_MAX_AGE_SECONDS * 1000) {
    throw new Error("Google sign-in expired. Click Connect Google and try again.");
  }
  return parsed;
}

async function googleTokenRequest(body: URLSearchParams): Promise<GoogleTokenSet> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = (await response.json().catch(() => null)) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  } | null;
  if (!response.ok || !payload?.access_token) {
    throw new Error(payload?.error_description || payload?.error || "Google token exchange failed.");
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresIn: payload.expires_in && payload.expires_in > 0 ? payload.expires_in : 3600,
    scope: payload.scope,
  };
}

export function exchangeGoogleAuthorizationCode(input: {
  code: string;
  verifier: string;
  redirectUri: string;
}) {
  return googleTokenRequest(
    new URLSearchParams({
      code: input.code,
      client_id: googleOAuthClientId(),
      client_secret: googleOAuthClientSecret(),
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
      code_verifier: input.verifier,
    }),
  );
}

export function refreshGoogleAccessToken(refreshToken: string) {
  return googleTokenRequest(
    new URLSearchParams({
      refresh_token: refreshToken,
      client_id: googleOAuthClientId(),
      client_secret: googleOAuthClientSecret(),
      grant_type: "refresh_token",
    }),
  );
}

export async function revokeGoogleToken(token: string) {
  await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  }).catch(() => undefined);
}
