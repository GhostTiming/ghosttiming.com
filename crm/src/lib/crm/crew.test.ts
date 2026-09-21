import { describe, expect, it } from "vitest";
import {
  filterCrewSearchResults,
  matchesCrewSearchQuery,
  personIsCrewCandidate,
  personIsTaggedToOrganization,
} from "./crew";

const clientOrg = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherOrg = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("crew candidate filter", () => {
  it("keeps active people tagged via primary org or membership", () => {
    expect(
      personIsCrewCandidate({
        isActive: true,
        archivedAt: null,
        organizationId: clientOrg,
        membershipOrgIds: [],
        clientOrganizationId: clientOrg,
      }),
    ).toBe(true);
    expect(
      personIsCrewCandidate({
        isActive: true,
        organizationId: otherOrg,
        membershipOrgIds: [clientOrg],
        clientOrganizationId: clientOrg,
      }),
    ).toBe(true);
  });

  it("excludes inactive, archived, and untagged people", () => {
    expect(
      personIsCrewCandidate({
        isActive: false,
        organizationId: clientOrg,
        clientOrganizationId: clientOrg,
      }),
    ).toBe(false);
    expect(
      personIsCrewCandidate({
        isActive: true,
        archivedAt: "2026-09-01T00:00:00.000Z",
        organizationId: clientOrg,
        clientOrganizationId: clientOrg,
      }),
    ).toBe(false);
    expect(
      personIsCrewCandidate({
        isActive: true,
        organizationId: otherOrg,
        membershipOrgIds: [otherOrg],
        clientOrganizationId: clientOrg,
        wasCrewForClientOrg: true,
      }),
    ).toBe(false);
  });

  it("does not treat prior crew history as a substitute for an org tag", () => {
    expect(
      personIsTaggedToOrganization({
        organizationId: null,
        membershipOrgIds: [],
        clientOrganizationId: clientOrg,
      }),
    ).toBe(false);
    expect(
      personIsCrewCandidate({
        isActive: true,
        organizationId: null,
        membershipOrgIds: [],
        clientOrganizationId: clientOrg,
        wasCrewForClientOrg: true,
      }),
    ).toBe(false);
  });
});

describe("crew search", () => {
  const alex = {
    id: "1",
    displayName: "Alex Rivera",
    email: "alex@runforacause.org",
    phone: "555-0100",
    organizationName: "Run For A Cause",
  };
  const jordan = {
    id: "2",
    displayName: "Jordan Lee",
    email: "jordan@example.com",
    phone: null,
  };

  it("hides every candidate until the user types", () => {
    expect(
      filterCrewSearchResults([alex, jordan], "   ", {
        organizationName: "Run For A Cause",
      }),
    ).toEqual([]);
  });

  it("matches people by name and the client organization name", () => {
    expect(matchesCrewSearchQuery(alex, "alex")).toBe(true);
    expect(
      filterCrewSearchResults([alex, jordan], "run for a cause", {
        organizationName: "Run For A Cause",
      }).map((person) => person.id),
    ).toEqual(["1", "2"]);
  });

  it("matches a first and last name even when they are stored separately", () => {
    const seth = {
      id: "3",
      firstName: "Seth",
      lastName: "Doe",
      email: "seth@example.com",
    };
    expect(matchesCrewSearchQuery(seth, "Seth Doe")).toBe(true);
    expect(matchesCrewSearchQuery(seth, "Doe Seth")).toBe(true);
    expect(filterCrewSearchResults([seth, jordan], "Seth Doe").map((person) => person.id)).toEqual([
      "3",
    ]);
  });

  it("omits people already assigned to the booking", () => {
    expect(
      filterCrewSearchResults([alex, jordan], "a", {
        assignedPersonIds: ["1"],
        organizationName: "Run For A Cause",
      }).map((person) => person.id),
    ).toEqual(["2"]);
  });
});
