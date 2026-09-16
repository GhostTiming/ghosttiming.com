import { describe, expect, it } from "vitest";
import {
  emptySearchResults,
  groupedSearchResults,
  joinSearchSecondary,
  parseSearchQuery,
  searchAccessFromContext,
  searchHitHref,
  searchLikeNeedle,
} from "./global-search";

describe("global search helpers", () => {
  it("requires a trimmed query of at least two characters", () => {
    expect(parseSearchQuery(" ")).toBeNull();
    expect(parseSearchQuery("a")).toBeNull();
    expect(parseSearchQuery("  5k  ")).toBe("5k");
    expect(parseSearchQuery("Firecracker 5K")?.length).toBeGreaterThan(2);
  });

  it("escapes ILIKE wildcards so a query cannot scan every row", () => {
    expect(searchLikeNeedle("100%")).toBe("100\\%");
    expect(searchLikeNeedle("a_b")).toBe("a\\_b");
    expect(searchLikeNeedle("path\\race")).toBe("path\\\\race");
  });

  it("builds record hrefs and task fallbacks", () => {
    expect(searchHitHref("bookings", "b1")).toBe("/bookings/b1");
    expect(searchHitHref("contacts", "p1")).toBe("/contacts/p1");
    expect(searchHitHref("organizations", "o1")).toBe("/organizations/o1");
    expect(searchHitHref("events", "e1")).toBe("/events/e1");
    expect(searchHitHref("prospects", "pr1")).toBe("/prospecting/pr1");
    expect(
      searchHitHref("tasks", "t1", { bookingId: "b1", prospectId: "pr1" }),
    ).toBe("/bookings/b1");
    expect(searchHitHref("tasks", "t1", { prospectId: "pr1" })).toBe(
      "/prospecting/pr1",
    );
    expect(searchHitHref("tasks", "t1")).toBe("/tasks");
  });

  it("hides empty groups and datasets the user cannot open", () => {
    const results = emptySearchResults();
    results.bookings = [
      { id: "b1", href: "/bookings/b1", label: "Firecracker 5K", secondary: "FL" },
    ];
    results.contacts = [
      { id: "c1", href: "/contacts/c1", label: "Michele", secondary: "michele@x.com" },
    ];
    results.prospects = [
      { id: "p1", href: "/prospecting/p1", label: "Lead", secondary: null },
    ];
    const prospectingOnly = searchAccessFromContext({
      canAccessOperations: false,
      canAccessProspecting: true,
      canAccessTasks: true,
    });
    expect(groupedSearchResults(results, prospectingOnly).map((group) => group.key)).toEqual(
      ["contacts", "prospects"],
    );
    expect(joinSearchSecondary([" Daytona ", null, "Confirmed", ""])).toBe(
      "Daytona · Confirmed",
    );
  });

  it("does not include financial fields in snippets", () => {
    expect(joinSearchSecondary(["Raleigh, NC", "Acme Timing", "Confirmed"])).not.toMatch(
      /\$|revenue|paid/i,
    );
  });
});
