import { describe, expect, it } from "vitest";

import { RaceRosterAuthError, readRaceRosterCredentialsFromEnv } from "./auth";

describe("readRaceRosterCredentialsFromEnv", () => {
  it("requires client id and secret", () => {
    expect(() => readRaceRosterCredentialsFromEnv({})).toThrow(RaceRosterAuthError);
  });

  it("accepts username/password with client credentials", () => {
    expect(
      readRaceRosterCredentialsFromEnv({
        RACE_ROSTER_CLIENT_ID: "id",
        RACE_ROSTER_CLIENT_SECRET: "secret",
        RACE_ROSTER_USERNAME: "timer@example.com",
        RACE_ROSTER_PASSWORD: "pw",
        RACE_ROSTER_CLIENT_NAME: "Ghost Timing",
      }),
    ).toMatchObject({
      clientId: "id",
      clientSecret: "secret",
      username: "timer@example.com",
      password: "pw",
      clientName: "Ghost Timing",
    });
  });

  it("accepts a refresh token without username/password", () => {
    expect(
      readRaceRosterCredentialsFromEnv({
        RACE_ROSTER_CLIENT_ID: "id",
        RACE_ROSTER_CLIENT_SECRET: "secret",
        RACE_ROSTER_REFRESH_TOKEN: "refresh",
      }),
    ).toMatchObject({
      refreshToken: "refresh",
    });
  });
});
