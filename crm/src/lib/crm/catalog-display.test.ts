import { describe, expect, it } from "vitest";
import {
  catalogListingExternalUrl,
  catalogListingOpenLabel,
  catalogProviderLabel,
  formatOfferingClock,
  getRunVibesEventUrl,
  htmlToPlainText,
  labelPerkTag,
  sortPerkKeys,
  sortVibeKeys,
} from "./catalog-display";

describe("catalog display helpers", () => {
  it("turns RunSignup HTML into readable text", () => {
    expect(
      htmlToPlainText(
        "<p><strong>Get moving.</strong></p><p>Walkers and runners are welcome.<br>Bring water.</p>",
      ),
    ).toBe("Get moving.\nWalkers and runners are welcome.\nBring water.");
  });

  it("orders included tags and drops generic swag when swag included is present", () => {
    expect(sortPerkKeys(["medal", "swag_generic", "swag_included", "shirt"])).toEqual(
      ["swag_included", "shirt", "medal"],
    );
    expect(labelPerkTag("food_drink")).toBe("Food & drink");
  });

  it("orders vibe tags the way Get Run Vibes lists race feel", () => {
    expect(sortVibeKeys(["cause_driven", "scenic", "fun"])).toEqual([
      "scenic",
      "fun",
      "cause_driven",
    ]);
  });

  it("builds a Get Run Vibes event URL from the listing slug", () => {
    expect(getRunVibesEventUrl("pandorasboxofrox-1000676")).toBe(
      "https://getrunvibes.com/events/pandorasboxofrox-1000676",
    );
    expect(getRunVibesEventUrl("")).toBeNull();
  });

  it("labels providers and picks the right external listing URL", () => {
    expect(catalogProviderLabel("race_roster")).toBe("Race Roster");
    expect(catalogProviderLabel("runsignup")).toBe("Get Run Vibes");
    expect(catalogListingOpenLabel("race_roster")).toBe("Open on Race Roster");
    expect(
      catalogListingExternalUrl({
        sourceProvider: "race_roster",
        registrationUrl: "https://raceroster.com/events/2026/112451/black-bear",
        catalogSlug: "black-bear-rr-112451",
      }),
    ).toBe("https://raceroster.com/events/2026/112451/black-bear");
    expect(
      catalogListingExternalUrl({
        sourceProvider: "runsignup",
        catalogSlug: "pandorasboxofrox-1000676",
      }),
    ).toBe("https://getrunvibes.com/events/pandorasboxofrox-1000676");
  });

  it("turns offering start times into a clock label and ignores midnight placeholders", () => {
    expect(formatOfferingClock("10/3/2026 19:00", "2026-10-04T03:00:00.000Z", "America/New_York")).toBe(
      "7:00 PM",
    );
    expect(formatOfferingClock("9/12/2020 00:00", "2020-09-12T04:00:00.000Z", "America/New_York")).toBeNull();
    expect(formatOfferingClock("19:30", null, "America/New_York")).toBe("7:30 PM");
  });
});
