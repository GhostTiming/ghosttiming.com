import { describe, expect, it } from "vitest";
import { organizationDeletionBlockers } from "./deletion";

describe("permanent deletion guards", () => {
  it("allows an unlinked archived test organization", () => {
    expect(organizationDeletionBlockers({
      bookings: 0,
      occurrences: 0,
      events: 0,
      linked_people: 0,
    })).toEqual([]);
  });

  it("names every blocking dependency", () => {
    expect(organizationDeletionBlockers({
      bookings: 2,
      occurrences: 1,
      events: 3,
      linked_people: 4,
    })).toEqual([
      "2 booking(s)",
      "1 event occurrence(s)",
      "3 owned event(s)",
      "4 linked contact(s)",
    ]);
  });
});

