import { describe, expect, it } from "vitest";
import {
  resolveCatalogListingQuery,
  suggestCatalogMatches,
  uniqueCatalogMatch,
  uniqueCatalogMatchForEvent,
  candidateHasUsableContactSql,
  listingHasGrvContactFlagSql,
  liveBookedCatalogListingIdsSql,
  liveBookingOwnsEventSql,
} from "./catalog-link";
import { eventMatchKey } from "./event-matching";

const hannah = {
  id: "listing-hannah",
  name: "Hannah's Heroes 5K",
  city: "Raleigh",
  state: "NC",
};
const hannahTrail = {
  id: "listing-hannah-trail",
  name: "Hannah's Heroes Trail Run",
  city: "Durham",
  state: "NC",
};
const spring5k = {
  id: "listing-spring",
  name: "Spring 5K",
  city: "Apex",
  state: "NC",
};
const fall5k = {
  id: "listing-fall",
  name: "Fall 5K",
  city: "Cary",
  state: "NC",
};
const privateRace = {
  id: "listing-private",
  name: "Private Race",
  city: "Raleigh",
  state: "NC",
};
const takenListing = {
  id: "listing-taken",
  name: "Taken Town Run",
  city: "Raleigh",
  state: "NC",
};

function listingsByKey(
  listings: { id: string; name: string }[],
) {
  const map = new Map<string, { id: string; name: string }[]>();
  for (const listing of listings) {
    const key = eventMatchKey(listing.name);
    const current = map.get(key) ?? [];
    current.push(listing);
    map.set(key, current);
  }
  return map;
}

describe("catalog listing matching", () => {
  it("auto-links only a unique normalized name", () => {
    const listings = listingsByKey([hannah, spring5k, fall5k]);
    expect(uniqueCatalogMatch("2026 Hannah's Heroes 5K", listings)?.id).toBe(
      "listing-hannah",
    );
    expect(uniqueCatalogMatch("5K", listings)).toBeNull();
    expect(uniqueCatalogMatch("Private Race", listings)).toBeNull();
  });

  it("does not auto-link when two listings share the same key", () => {
    const listings = listingsByKey([
      { id: "a", name: "Circle K 5K" },
      { id: "b", name: "2025 Circle K 5K" },
    ]);
    expect(uniqueCatalogMatch("Circle K 5K", listings)).toBeNull();
  });

  it("resolves a name collision when the event date uniquely matches one listing", () => {
    const wilson = {
      id: "wilson",
      name: "Colors of Courage 5k",
      city: "Wilson",
      state: "NC",
      next_start_at: "2026-09-19T13:00:00.000Z",
    };
    const pikeville = {
      id: "pikeville",
      name: "Colors of Courage 5K",
      city: "Pikeville",
      state: "KY",
      next_start_at: null,
    };
    expect(
      uniqueCatalogMatchForEvent(
        { name: "Colors of Courage 5k", raceDate: "2026-09-19T04:00:00.000Z" },
        [wilson, pikeville],
      )?.id,
    ).toBe("wilson");
    expect(
      uniqueCatalogMatchForEvent({ name: "Colors of Courage 5k" }, [
        {
          ...wilson,
          next_start_at: "2026-09-19T13:00:00.000Z",
        },
        {
          ...pikeville,
          next_start_at: "2026-10-01T13:00:00.000Z",
        },
      ]),
    ).toBeNull();
  });

  it("suggests exact key matches before similar overlapping names", () => {
    const suggestions = suggestCatalogMatches(
      { name: "Hannah's Heroes 5K", city: "Raleigh", state: "NC" },
      [hannah, hannahTrail, spring5k, takenListing],
      { takenIds: ["listing-taken"] },
    );
    expect(suggestions[0]).toMatchObject({
      id: "listing-hannah",
      reason: "exact",
    });
    expect(suggestions.some((row) => row.id === "listing-hannah-trail")).toBe(
      true,
    );
    expect(suggestions.some((row) => row.id === "listing-taken")).toBe(false);
  });

  it("does not suggest generic private races or weak 5K collisions", () => {
    expect(
      suggestCatalogMatches({ name: "Private Race", state: "NC" }, [
        privateRace,
        spring5k,
      ]),
    ).toEqual([]);
    expect(
      suggestCatalogMatches({ name: "5K", state: "NC" }, [spring5k, fall5k]),
    ).toEqual([]);
  });

  it("resolves a unique search and leaves ambiguous names unmatched", () => {
    const listings = [hannah, spring5k, fall5k];
    expect(
      resolveCatalogListingQuery("Hannah's Heroes", listings).match?.id,
    ).toBe("listing-hannah");
    const ambiguous = resolveCatalogListingQuery("5K", listings);
    expect("match" in ambiguous).toBe(false);
    expect(ambiguous.matches?.length).toBeGreaterThan(1);
    expect(resolveCatalogListingQuery("nope", listings).matches).toEqual([]);
  });

  it("resolves a search using name and location together", () => {
    const firecracker = {
      id: "listing-firecracker",
      name: "Firecracker 5K",
      city: "Daytona Beach",
      state: "FL",
    };
    expect(
      resolveCatalogListingQuery("Firecracker 5K Daytona Beach", [
        firecracker,
        hannah,
      ]).match?.id,
    ).toBe("listing-firecracker");
    expect(
      resolveCatalogListingQuery("Daytona", [firecracker, hannah]).match?.id,
    ).toBe("listing-firecracker");
  });

  it("resolves a search by slug brand tokens or listing id", () => {
    const church = {
      id: "99772553-cef7-4f03-80e2-014ef4ca8c6f",
      name: "SVDP Church of Our Saviour FOP 5K Run/Walk",
      slug: "svdpchurchofoursaviourfoprunwalk-1081007",
      source_race_id: "159997",
      source_event_ids: ["1081007"],
      city: "Cocoa Beach",
      state: "FL",
    };
    expect(
      resolveCatalogListingQuery("SVDP Church of Our Saviour", [
        church,
        hannah,
      ]).match?.id,
    ).toBe(church.id);
    expect(
      resolveCatalogListingQuery("1081007", [church, hannah]).match?.id,
    ).toBe(church.id);
    expect(
      resolveCatalogListingQuery("159997", [church, hannah]).match?.id,
    ).toBe(church.id);
  });
});

describe("Get Run Vibes lead-contact flags", () => {
  it("requires the original description_has_email or description_has_phone flag", () => {
    const sql = listingHasGrvContactFlagSql("rl.id");
    expect(sql).toContain("lead_contact");
    expect(sql).toContain("description_has_email");
    expect(sql).toContain("description_has_phone");
    expect(sql).toContain("tag_value = 'true'");
  });

  it("keeps unprocessed flagged listings and drops processed rows with no contact", () => {
    const sql = candidateHasUsableContactSql(
      "primary_phone",
      "primary_email",
      "contact_processed",
    );
    expect(sql).toContain("primary_phone IS NOT NULL");
    expect(sql).toContain("primary_email IS NOT NULL");
    expect(sql).toContain("NOT contact_processed");
  });
});

describe("live booking ownership", () => {
  it("treats a live booking on the same event as already booked", () => {
    const sql = liveBookingOwnsEventSql("event.id");
    expect(sql).toContain("booked_occurrence.event_id = event.id");
    expect(sql).toContain("booked.archived_at IS NULL");
    expect(sql).toContain("closed_lost");
  });

  it("only treats live bookings as taken catalog listings, not prospect links", () => {
    const sql = liveBookedCatalogListingIdsSql();
    expect(sql).toContain("crm.bookings");
    expect(sql).toContain("closed_lost");
    expect(sql).toContain("catalog_race_listing_id");
    expect(sql).not.toContain("crm.prospects");
  });
});
