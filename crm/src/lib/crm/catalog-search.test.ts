import { describe, expect, it } from "vitest";
import {
  catalogListingSearchHaystackSql,
  catalogListingSearchQuery,
  catalogListingSearchWhereSql,
  catalogSearchLikeNeedles,
  catalogSearchTokens,
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
    expect(catalogListingSearchWhereSql(2)).toContain("$1");
    expect(catalogListingSearchWhereSql(2)).toContain("$2");
  });
});
