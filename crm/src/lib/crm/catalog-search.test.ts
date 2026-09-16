import { describe, expect, it } from "vitest";
import {
  catalogListingSearchHaystackSql,
  catalogListingSearchQuery,
  catalogListingSearchWhereSql,
  catalogSearchLikeNeedles,
  catalogSearchTokens,
  listingEventYear,
  listingMatchesSearch,
} from "./catalog-search";

const firecracker = {
  name: "Firecracker 5K",
  city: "Daytona Beach",
  state: "FL",
  zipcode: "32118",
};

describe("catalog listing search", () => {
  it("tokenizes race names and locations", () => {
    expect(catalogSearchTokens("Firecracker 5K Daytona Beach")).toEqual([
      "firecracker",
      "5k",
      "daytona",
      "beach",
    ]);
    expect(catalogSearchLikeNeedles("FL")).toEqual(["fl"]);
  });

  it("builds a listing search from race profile fields", () => {
    expect(
      catalogListingSearchQuery({
        name: "Colors of Courage 5K",
        city: "Wilson",
        state: "NC",
      }),
    ).toBe("Colors of Courage 5K Wilson NC");
    expect(
      catalogListingSearchQuery({ name: "Private Race", city: "  ", state: null }),
    ).toBe("Private Race");
  });

  it("matches name and location together", () => {
    expect(listingMatchesSearch(firecracker, "Firecracker 5K")).toBe(true);
    expect(
      listingMatchesSearch(firecracker, "Firecracker 5K Daytona Beach"),
    ).toBe(true);
    expect(listingMatchesSearch(firecracker, "daytona")).toBe(true);
    expect(listingMatchesSearch(firecracker, "32118")).toBe(true);
    expect(listingMatchesSearch(firecracker, "Hannah Heroes")).toBe(false);
  });

  it("searches name, street, city, state, and zip in SQL", () => {
    expect(catalogListingSearchHaystackSql).toContain("name");
    expect(catalogListingSearchHaystackSql).toContain("street");
    expect(catalogListingSearchHaystackSql).toContain("city");
    expect(catalogListingSearchHaystackSql).toContain("state");
    expect(catalogListingSearchHaystackSql).toContain("zipcode");
    expect(catalogListingSearchHaystackSql).toContain("next_start_at");
    expect(catalogListingSearchHaystackSql).toContain("edition_year");
    expect(catalogListingSearchWhereSql(2)).toContain("$1");
    expect(catalogListingSearchWhereSql(2)).toContain("$2");
  });

  it("includes the listing year in search text and labels", () => {
    expect(
      listingEventYear("2025-09-20 08:00:00-04"),
    ).toBe("2025");
    expect(listingEventYear(new Date("2026-03-01T12:00:00.000Z"))).toBe("2026");
    expect(listingEventYear(null)).toBeNull();
    expect(listingEventYear(null, 2024)).toBe("2024");
    expect(
      listingMatchesSearch(
        { ...firecracker, next_start_at: "2025-07-04T12:00:00.000Z" },
        "2025",
      ),
    ).toBe(true);
    expect(
      listingMatchesSearch(
        { ...firecracker, next_start_at: "2026-07-04T12:00:00.000Z" },
        "2025",
      ),
    ).toBe(false);
    expect(
      listingMatchesSearch(
        { ...firecracker, edition_year: 2024 },
        "2024",
      ),
    ).toBe(true);
  });
});
