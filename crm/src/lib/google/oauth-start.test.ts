import { describe, expect, it } from "vitest";
import { googleOAuthStartHref } from "./oauth-start";

describe("googleOAuthStartHref", () => {
  it("builds an absolute Connect Google URL that keeps the current page", () => {
    const href = googleOAuthStartHref({
      returnTo: "/settings?tab=google",
      origin: "https://crm.example.com",
    });
    const url = new URL(href);
    expect(url.origin).toBe("https://crm.example.com");
    expect(url.pathname).toBe("/api/google/oauth/start");
    expect(url.searchParams.get("returnTo")).toBe("/settings?tab=google");
    expect(url.searchParams.has("addAccount")).toBe(false);
  });

  it("asks Google to pick another account when adding a mailbox", () => {
    const href = googleOAuthStartHref({
      returnTo: "/dashboard",
      addAccount: true,
      loginHint: "old@example.com",
    });
    expect(href).toContain("addAccount=1");
    expect(href).not.toContain("loginHint=");
  });
});
