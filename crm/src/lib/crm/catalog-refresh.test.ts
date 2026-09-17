import { describe, expect, it } from "vitest";
import {
  formatCatalogRefreshSummary,
  shouldSkipCatalogRefresh,
  summarizeCatalogRefresh,
} from "./catalog-refresh";

describe("shouldSkipCatalogRefresh", () => {
  const now = new Date("2026-09-17T12:00:00Z");

  it("skips paid and closed-lost bookings", () => {
    expect(
      shouldSkipCatalogRefresh({
        stageKey: "paid",
        raceDate: "2026-10-11T12:00:00Z",
        now,
      }),
    ).toMatch(/paid/i);
    expect(
      shouldSkipCatalogRefresh({
        stageKey: "closed_lost",
        raceDate: "2026-10-11T12:00:00Z",
        now,
      }),
    ).toMatch(/closed lost/i);
  });

  it("skips past race dates so duplicate history is not rewritten", () => {
    expect(
      shouldSkipCatalogRefresh({
        stageKey: "confirmed",
        raceDate: "2026-04-11T11:25:00Z",
        now,
      }),
    ).toMatch(/past race date/i);
  });

  it("allows upcoming linked bookings", () => {
    expect(
      shouldSkipCatalogRefresh({
        stageKey: "confirmed",
        raceDate: "2026-10-11T12:00:00Z",
        now,
      }),
    ).toBeNull();
  });
});

describe("catalog refresh summary", () => {
  it("counts updated, skipped, and failed rows", () => {
    const summary = summarizeCatalogRefresh([
      { bookingId: "1", status: "updated" },
      { bookingId: "2", status: "skipped", error: "Past race date — left unchanged." },
      { bookingId: "3", status: "failed", error: "Boom" },
    ]);
    expect(summary).toMatchObject({ updated: 1, skipped: 1, failed: 1 });
    expect(formatCatalogRefreshSummary(summary)).toContain(
      "Past race date — left unchanged.",
    );
  });
});
