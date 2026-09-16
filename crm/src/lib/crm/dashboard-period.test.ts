import { describe, expect, it } from "vitest";
import { resolveDashboardPeriod } from "./dashboard-period";

const now = new Date("2026-09-15T19:00:00.000Z");

describe("dashboard reporting periods", () => {
  it("defaults to the current Eastern year", () => {
    expect(resolveDashboardPeriod({}, now)).toMatchObject({
      key: "year",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      endExclusive: "2027-01-01",
      label: "2026",
    });
  });

  it("supports all-time reporting", () => {
    expect(resolveDashboardPeriod({ period: "all" }, now)).toMatchObject({
      key: "all",
      startDate: null,
      endDate: null,
      endExclusive: null,
      label: "All time",
    });
  });

  it("accepts an inclusive custom range", () => {
    expect(
      resolveDashboardPeriod(
        { period: "custom", from: "2025-03-01", to: "2025-03-31" },
        now,
      ),
    ).toMatchObject({
      key: "custom",
      startDate: "2025-03-01",
      endDate: "2025-03-31",
      endExclusive: "2025-04-01",
    });
  });

  it("falls back to the current year for invalid custom dates", () => {
    expect(
      resolveDashboardPeriod(
        { period: "custom", from: "2026-02-30", to: "2026-01-01" },
        now,
      ).key,
    ).toBe("year");
  });
});
