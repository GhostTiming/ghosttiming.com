import { describe, expect, it } from "vitest";
import {
  emailMatchesBlacklist,
  formatBlacklistPattern,
  parseBlacklistPattern,
} from "./email-blacklist";

describe("email blacklist patterns", () => {
  it("stores a full address as an exact email match", () => {
    expect(parseBlacklistPattern("  Info@RaceCompany.COM. ")).toEqual({
      success: true,
      pattern: "info@racecompany.com",
      matchKind: "email",
    });
  });

  it("stores @domain.com and bare domains as domain matches", () => {
    expect(parseBlacklistPattern("@RaceCompany.com")).toEqual({
      success: true,
      pattern: "racecompany.com",
      matchKind: "domain",
    });
    expect(parseBlacklistPattern("racecompany.com")).toEqual({
      success: true,
      pattern: "racecompany.com",
      matchKind: "domain",
    });
  });

  it("rejects empty or invalid values", () => {
    expect(parseBlacklistPattern("   ").success).toBe(false);
    expect(parseBlacklistPattern("not-an-email").success).toBe(false);
    expect(parseBlacklistPattern("info@").success).toBe(false);
  });

  it("matches exact emails and every address at a blacklisted domain", () => {
    const entries = [
      { pattern: "skip@timer.com", matchKind: "email" as const },
      { pattern: "racecompany.com", matchKind: "domain" as const },
    ];
    expect(emailMatchesBlacklist("skip@timer.com", entries)).toBe(true);
    expect(emailMatchesBlacklist("other@timer.com", entries)).toBe(false);
    expect(emailMatchesBlacklist("rd@RaceCompany.com", entries)).toBe(true);
    expect(emailMatchesBlacklist("hello@elsewhere.com", entries)).toBe(false);
  });

  it("formats domain rules with a leading @", () => {
    expect(
      formatBlacklistPattern({ pattern: "racecompany.com", matchKind: "domain" }),
    ).toBe("@racecompany.com");
  });
});
