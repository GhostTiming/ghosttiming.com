import { describe, expect, it } from "vitest";
import type { RunSignupRace } from "./runsignup";
import {
  isUnpublishedRunSignupRace,
  mergeRunSignupSearchResults,
  profileFromRunSignupAccessToken,
  readRunSignupProfile,
  runSignupRaceMatchesName,
} from "./runsignup-private";

function race(id: number, name: string, extra: Partial<RunSignupRace> = {}): RunSignupRace {
  return { race_id: id, name, ...extra };
}

describe("unpublished RunSignUp races", () => {
  it("treats private and draft flags as unpublished", () => {
    expect(isUnpublishedRunSignupRace(race(1, "Public 5K"))).toBe(false);
    expect(isUnpublishedRunSignupRace(race(2, "Club", { is_private_race: "T" }))).toBe(true);
    expect(isUnpublishedRunSignupRace(race(3, "Draft", { is_draft_race: "T" }))).toBe(true);
  });

  it("keeps public matches and adds account-only races as private", () => {
    const merged = mergeRunSignupSearchResults({
      publicRaces: [race(10, "Published Turkey Trot")],
      publicSearchSucceeded: true,
      accountRaces: [
        race(10, "Published Turkey Trot"),
        race(11, "Company Turkey Trot", { is_private_race: "F" }),
      ],
    });
    expect(merged).toEqual([
      { race: race(10, "Published Turkey Trot"), unpublished: false },
      {
        race: race(11, "Company Turkey Trot", { is_private_race: "F" }),
        unpublished: true,
      },
    ]);
  });

  it("does not mark every account race private when the public search failed", () => {
    const accountRace = race(11, "Company Turkey Trot");
    const merged = mergeRunSignupSearchResults({
      publicRaces: [],
      publicSearchSucceeded: false,
      accountRaces: [accountRace],
    });
    expect(merged).toEqual([{ race: accountRace, unpublished: false }]);
  });

  it("matches a race name by the meaningful words in the search", () => {
    expect(runSignupRaceMatchesName(race(1, "Company Turkey Trot"), "turkey trot")).toBe(
      true,
    );
    expect(runSignupRaceMatchesName(race(1, "Company Turkey Trot"), "beach")).toBe(false);
  });

  it("reads the RunSignUp user from a profile payload or access token", () => {
    expect(
      readRunSignupProfile({
        user: { user_id: 42, email: "timer@example.com", first_name: "Ghost", last_name: "Timing" },
      }),
    ).toEqual({
      userId: "42",
      email: "timer@example.com",
      name: "Ghost Timing",
    });
    const payload = Buffer.from(
      JSON.stringify({ sub: "99", email: "timer@example.com", name: "Timer" }),
    ).toString("base64url");
    expect(profileFromRunSignupAccessToken(`header.${payload}.sig`)).toEqual({
      userId: "99",
      email: "timer@example.com",
      name: "Timer",
    });
  });
});
