import { afterEach, describe, expect, it } from "vitest";
import {
  canHydrateStoredGoogleToken,
  clearStoredGoogleToken,
  googleLoginHint,
  googleTokenIsFresh,
  pickPreferredGoogleConnection,
  readStoredGoogleToken,
  shouldClearStoredGoogleTokenOnRestore,
  storedTokenFromResponse,
  writeStoredGoogleToken,
} from "./token-store";

const store = new Map<string, string>();

function installLocalStorage() {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
      },
    },
  });
}

const micheConnection = {
  google_sub: "google-sub",
  google_email: "michele@ghosttiming.com",
  gmail_status: "synced",
  calendar_status: "connected",
};

describe("Google token store", () => {
  afterEach(() => {
    store.clear();
    Reflect.deleteProperty(globalThis, "window");
  });

  it("round-trips a fresh access token for the CRM user", () => {
    installLocalStorage();
    const token = storedTokenFromResponse("google-sub", "ya29.token", 3600, "gmail calendar");
    writeStoredGoogleToken("user-1", token);
    const stored = readStoredGoogleToken("user-1");
    expect(stored?.accessToken).toBe("ya29.token");
    expect(stored?.googleSub).toBe("google-sub");
    expect(googleTokenIsFresh(stored!)).toBe(true);
    expect(readStoredGoogleToken("user-2")).toBeNull();
  });

  it("keeps an expired token until it is explicitly cleared", () => {
    installLocalStorage();
    writeStoredGoogleToken("user-1", {
      googleSub: "google-sub",
      accessToken: "ya29.old",
      expiresAt: Date.now() - 1_000,
    });
    writeStoredGoogleToken("user-2", storedTokenFromResponse("other-sub", "ya29.other", 3600));

    const stored = readStoredGoogleToken("user-1");
    expect(stored).not.toBeNull();
    expect(googleTokenIsFresh(stored!)).toBe(false);
    expect(readStoredGoogleToken("user-2")?.accessToken).toBe("ya29.other");

    expect(shouldClearStoredGoogleTokenOnRestore(stored, [micheConnection])).toBe(false);
    expect(canHydrateStoredGoogleToken(stored, [micheConnection])).toBe(false);
    expect(googleLoginHint(stored, [micheConnection])).toBe("michele@ghosttiming.com");
    expect(readStoredGoogleToken("user-1")?.accessToken).toBe("ya29.old");
  });

  it("does not treat CRM sign-out as a reason to clear a known Google grant", () => {
    installLocalStorage();
    const token = storedTokenFromResponse("google-sub", "ya29.token", 3600);
    writeStoredGoogleToken("user-1", token);

    expect(shouldClearStoredGoogleTokenOnRestore(token, [micheConnection])).toBe(false);
    expect(canHydrateStoredGoogleToken(token, [micheConnection])).toBe(true);
    expect(readStoredGoogleToken("user-1")?.accessToken).toBe("ya29.token");
  });

  it("clears only when the stored Google identity is unknown or disconnected", () => {
    const stored = storedTokenFromResponse("google-sub", "ya29.token", 3600);
    expect(shouldClearStoredGoogleTokenOnRestore(stored, [])).toBe(true);
    expect(
      shouldClearStoredGoogleTokenOnRestore(stored, [
        { ...micheConnection, gmail_status: "disconnected", calendar_status: "disconnected" },
      ]),
    ).toBe(true);
    expect(
      shouldClearStoredGoogleTokenOnRestore(stored, [
        { ...micheConnection, google_sub: "someone-else" },
      ]),
    ).toBe(true);
    expect(
      shouldClearStoredGoogleTokenOnRestore(stored, [
        { ...micheConnection, has_offline_grant: false },
      ]),
    ).toBe(true);
  });

  it("uses the stored Google account email as the silent login hint", () => {
    const stored = storedTokenFromResponse("google-sub-2", "ya29.token", 3600);
    expect(
      googleLoginHint(stored, [
        micheConnection,
        {
          google_sub: "google-sub-2",
          google_email: "second@ghosttiming.com",
          gmail_status: "connected",
          calendar_status: "connected",
        },
      ]),
    ).toBe("second@ghosttiming.com");
  });

  it("prefers the saved Google account when that lasting link still exists", () => {
    const second = {
      google_sub: "google-sub-2",
      google_email: "second@ghosttiming.com",
      gmail_status: "connected",
      calendar_status: "connected",
      has_offline_grant: true,
    };
    expect(pickPreferredGoogleConnection([micheConnection, second], "google-sub-2")?.google_email).toBe(
      "second@ghosttiming.com",
    );
    expect(
      pickPreferredGoogleConnection(
        [micheConnection, { ...second, has_offline_grant: false }],
        "google-sub-2",
      )?.google_email,
    ).toBe("michele@ghosttiming.com");
  });

  it("can still explicitly clear a token for Disconnect Google", () => {
    installLocalStorage();
    writeStoredGoogleToken("user-1", storedTokenFromResponse("google-sub", "ya29.token", 3600));
    writeStoredGoogleToken("user-2", storedTokenFromResponse("other-sub", "ya29.other", 3600));
    clearStoredGoogleToken("user-1");
    expect(readStoredGoogleToken("user-1")).toBeNull();
    expect(readStoredGoogleToken("user-2")?.accessToken).toBe("ya29.other");
  });
});
