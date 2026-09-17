import { describe, expect, it } from "vitest";
import { displayUserName, splitFullName } from "./user-profile";

describe("user profile helpers", () => {
  it("splits a hyphenated last name after the first space", () => {
    expect(splitFullName("Michelle Splitstone-Laloggia")).toEqual({
      firstName: "Michelle",
      lastName: "Splitstone-Laloggia",
    });
  });

  it("keeps a single-word name as first name only", () => {
    expect(splitFullName("Seth")).toEqual({ firstName: "Seth", lastName: null });
  });

  it("builds a display name from profile fields before falling back", () => {
    expect(
      displayUserName({
        firstName: "Michelle",
        lastName: "Splitstone-Laloggia",
        fallback: "michelle@getrunvibes.com",
      }),
    ).toBe("Michelle Splitstone-Laloggia");
    expect(displayUserName({ fallback: "michelle@getrunvibes.com" })).toBe(
      "michelle@getrunvibes.com",
    );
  });
});
