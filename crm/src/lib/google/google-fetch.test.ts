import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GoogleAuthError,
  GoogleQuotaError,
  googleFetch,
  isGoogleQuotaError,
  resetGoogleFetchStateForTests,
} from "./google-fetch";

function jsonResponse(
  status: number,
  body: unknown,
  headers?: Record<string, string>,
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 403 ? "Forbidden" : "Error",
    headers: new Headers(headers),
    json: async () => body,
  };
}

describe("Google fetch quota handling", () => {
  afterEach(() => {
    resetGoogleFetchStateForTests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("recognizes Gmail total query cost errors", () => {
    expect(
      isGoogleQuotaError(
        403,
        "Quota exceeded for quota metric 'Total Query Cost' and limit 'Units per minute per user'",
        "RESOURCE_EXHAUSTED",
      ),
    ).toBe(true);
    expect(isGoogleQuotaError(403, "Request had insufficient authentication scopes.")).toBe(
      false,
    );
  });

  it("retries a Gmail quota 403 and then succeeds", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(403, {
          error: {
            message:
              "Quota exceeded for quota metric 'Total Query Cost' and limit 'Units per minute per user' of service 'gmail.googleapis.com' for consumer 'project_number:337749508248'.",
            status: "RESOURCE_EXHAUSTED",
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { emailAddress: "me@example.org" }));
    vi.stubGlobal("fetch", fetchMock);

    const pending = googleFetch(
      "token",
      "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    );
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toEqual({ emailAddress: "me@example.org" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not treat a permission 403 as quota", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(403, {
        error: { message: "Request had insufficient authentication scopes." },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      googleFetch("token", "https://gmail.googleapis.com/gmail/v1/users/me/profile"),
    ).rejects.toBeInstanceOf(GoogleAuthError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up with a quota error after retries", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(403, {
        error: {
          message: "Quota exceeded for quota metric 'Total Query Cost'",
          status: "RESOURCE_EXHAUSTED",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const pending = googleFetch(
      "token",
      "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    ).catch((error) => error);
    await vi.runAllTimersAsync();
    const error = await pending;
    expect(error).toBeInstanceOf(GoogleQuotaError);
    expect(String(error)).toContain("per-minute limit");
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });
});
