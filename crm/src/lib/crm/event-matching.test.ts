import { describe, expect, it } from "vitest";
import { uniqueCatalogMatch } from "./catalog-link";
import { eventMatchKey, isGenericEventName } from "./event-matching";

describe("event name matching", () => {
  it("treats year prefixes and The as the same standing race", () => {
    expect(eventMatchKey("2025 Circle K 5K")).toBe(eventMatchKey("Circle K 5K"));
    expect(eventMatchKey("The Railway Races")).toBe(eventMatchKey("Railway Races"));
    expect(eventMatchKey("1911 Initiative 5K")).toBe("1911 initiative 5k");
  });

  it("keeps generic private races ungrouped", () => {
    expect(isGenericEventName("Private Race")).toBe(true);
    expect(isGenericEventName("Private Races - Run4aCause")).toBe(true);
    expect(isGenericEventName("Circle K 5K")).toBe(false);
  });

  it("links a CRM event to a unique catalog listing", () => {
    const listings = new Map([
      [
        eventMatchKey("2025 UNC SHAC 5K"),
        [{ id: "listing-1", name: "2025 UNC SHAC 5K" }],
      ],
      [
        eventMatchKey("5K"),
        [
          { id: "a", name: "Spring 5K" },
          { id: "b", name: "Fall 5K" },
        ],
      ],
    ]);
    expect(uniqueCatalogMatch("UNC SHAC 5K", listings)?.id).toBe("listing-1");
    expect(uniqueCatalogMatch("5K", listings)).toBeNull();
    expect(uniqueCatalogMatch("Private Race", listings)).toBeNull();
  });
});
