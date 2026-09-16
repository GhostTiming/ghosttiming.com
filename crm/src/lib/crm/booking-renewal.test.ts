import { describe, expect, it } from "vitest";
import {
  defaultRenewalYear,
  pickCatalogEditionForYear,
  renewalFieldPolicy,
  renewalYearDelta,
  RENEWAL_BOOKING_STAGE_KEY,
  shiftLocalDateTimeByYears,
  shouldOpenNewStandingEvent,
} from "./booking-renewal";

describe("booking renewal copy logic", () => {
  it("defaults to the next calendar year from the event start", () => {
    expect(
      defaultRenewalYear({
        raceDate: "2025-10-12T07:30",
        occurrenceYear: 2025,
      }),
    ).toBe(2026);
    expect(defaultRenewalYear({ occurrenceYear: 2024 })).toBe(2025);
    expect(defaultRenewalYear({ now: new Date("2026-03-01T00:00:00Z") })).toBe(
      2027,
    );
    expect(renewalYearDelta(2025, 2027)).toBe(2);
  });

  it("shifts local race clocks without inventing a time", () => {
    expect(shiftLocalDateTimeByYears("2025-10-12T07:30", 1)).toBe(
      "2026-10-12T07:30",
    );
    expect(shiftLocalDateTimeByYears(null, 1)).toBeNull();
  });

  it("copies operational relationships and resets completed race-day state", () => {
    const policy = renewalFieldPolicy();
    expect(policy.copyBooking).toEqual(
      expect.arrayContaining([
        "direct_client_organization_id",
        "primary_contact_person_id",
        "assigned_user_id",
        "notes",
      ]),
    );
    expect(policy.copyOccurrenceAlways).toEqual(
      expect.arrayContaining([
        "crew_assignments",
        "course_points",
        "hardware_event_name",
        "scoring_expectations",
        "notes",
      ]),
    );
    expect(policy.resetBooking).toEqual(
      expect.arrayContaining([
        "stage:confirmed",
        "actual_revenue",
        "amount_paid",
        "completed_at",
        "payment_at",
        "prep_items:fresh",
      ]),
    );
    expect(policy.neverCopyOccurrence).toEqual(
      expect.arrayContaining([
        "calculated_arrival_at",
        "arrival_override_at",
        "catalog_race_edition_id",
      ]),
    );
    expect(RENEWAL_BOOKING_STAGE_KEY).toBe("confirmed");
  });

  it("lets Get Run Vibes replace dates, location, and offerings", () => {
    const policy = renewalFieldPolicy();
    expect(policy.copyOccurrenceUnlessCatalogRefresh).toEqual(
      expect.arrayContaining([
        "street_override",
        "occurrence_races:shifted",
        "registration_url_override",
      ]),
    );
  });

  it("prefers the catalog edition for the upcoming year", () => {
    const picked = pickCatalogEditionForYear(
      [
        {
          id: "2025",
          editionYear: 2025,
          startsAt: "2025-10-12",
          isFuture: false,
        },
        {
          id: "2026",
          editionYear: 2026,
          startsAt: "2026-10-11",
          isFuture: true,
        },
      ],
      2026,
    );
    expect(picked?.id).toBe("2026");
    expect(pickCatalogEditionForYear([], 2026)).toBeNull();
  });

  it("only opens a new standing event for a different GRV listing or renamed race", () => {
    expect(
      shouldOpenNewStandingEvent({
        refreshFromCatalog: true,
        currentListingId: "listing-a",
        nextListingId: "listing-a",
        currentEventName: "Firecracker 5K",
      }),
    ).toBe(false);
    expect(
      shouldOpenNewStandingEvent({
        refreshFromCatalog: true,
        currentListingId: "listing-a",
        nextListingId: "listing-2026",
        currentEventName: "Firecracker 5K",
      }),
    ).toBe(true);
    expect(
      shouldOpenNewStandingEvent({
        refreshFromCatalog: false,
        currentEventName: "Firecracker 5K",
        nextEventName: "Firecracker 5K",
      }),
    ).toBe(false);
    expect(
      shouldOpenNewStandingEvent({
        refreshFromCatalog: false,
        currentEventName: "Firecracker 5K",
        nextEventName: "Private Corporate Challenge",
      }),
    ).toBe(true);
  });
});
