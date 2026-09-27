import { describe, expect, it } from "vitest";
import {
  gmailAutoCatchupQuery,
  shouldSaveGmailCursor,
} from "./gmail-auto-sync-plan";

describe("automatic Gmail sync plan", () => {
  it("searches the last 14 days when Gmail has never been synced", () => {
    expect(gmailAutoCatchupQuery(null, new Date("2026-09-27T15:00:00Z"))).toBe(
      " after:2026/09/13",
    );
  });

  it("overlaps the previous sync by one day and does not look back further than 14 days", () => {
    expect(
      gmailAutoCatchupQuery("2026-09-20T12:00:00.000Z", new Date("2026-09-27T15:00:00Z")),
    ).toBe(" after:2026/09/19");
    expect(
      gmailAutoCatchupQuery("2025-01-01T00:00:00.000Z", new Date("2026-09-27T15:00:00Z")),
    ).toBe(" after:2026/09/13");
  });

  it("saves the Gmail cursor only after this catch-up pass is finished", () => {
    expect(
      shouldSaveGmailCursor({
        reachedEnd: true,
        pagesScanned: 2,
        pageBudget: 20,
        unknownCount: 40,
        cap: 40,
      }),
    ).toBe(true);
    expect(
      shouldSaveGmailCursor({
        reachedEnd: true,
        pagesScanned: 2,
        pageBudget: 20,
        unknownCount: 41,
        cap: 40,
      }),
    ).toBe(false);
    expect(
      shouldSaveGmailCursor({
        reachedEnd: false,
        pagesScanned: 20,
        pageBudget: 20,
        unknownCount: 0,
        cap: 40,
      }),
    ).toBe(true);
    expect(
      shouldSaveGmailCursor({
        reachedEnd: false,
        pagesScanned: 4,
        pageBudget: 20,
        unknownCount: 10,
        cap: 40,
      }),
    ).toBe(false);
  });
});
