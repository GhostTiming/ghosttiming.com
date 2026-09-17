import { afterEach, describe, expect, it } from "vitest";
import { buildGoogleAuthorizeRedirect, createPkcePair, safeOAuthReturnTo } from "./oauth";

describe("Google OAuth helpers", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
    delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
  });

  it("rejects open redirects", () => {
    expect(safeOAuthReturnTo("/bookings")).toBe("/bookings");
    expect(safeOAuthReturnTo("//evil.example")).toBe("/dashboard");
    expect(safeOAuthReturnTo("https://evil.example")).toBe("/dashboard");
    expect(safeOAuthReturnTo(null)).toBe("/dashboard");
  });

  it("builds a PKCE verifier and S256 challenge", () => {
    const pair = createPkcePair();
    expect(pair.verifier.length).toBeGreaterThanOrEqual(43);
    expect(pair.challenge.length).toBeGreaterThan(20);
    expect(pair.challenge).not.toBe(pair.verifier);
  });

  it("requests an offline Google grant with PKCE", () => {
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = "client.apps.googleusercontent.com";
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = "a".repeat(64);
    const started = buildGoogleAuthorizeRedirect({
      request: new Request("http://localhost:3001/api/google/oauth/start"),
      returnTo: "/bookings",
    });
    const url = new URL(started.authorizeUrl);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3001/api/google/oauth/callback",
    );
    expect(started.payload.verifier).toBeTruthy();
    expect(started.cookieValue).toContain(".");
  });
});
