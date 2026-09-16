import { afterEach, describe, expect, it, vi } from "vitest";
import { requestGoogleAccessToken } from "./gis";

describe("GIS token client", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
    vi.restoreAllMocks();
  });

  it("passes prompt and login_hint to initTokenClient and requestAccessToken", async () => {
    const requestAccessToken = vi.fn();
    const initTokenClient = vi.fn((config: {
      login_hint?: string;
      prompt?: string;
      callback: (response: { access_token: string }) => void;
    }) => {
      queueMicrotask(() => config.callback({ access_token: "ya29.from-gis" }));
      return { requestAccessToken };
    });

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        google: {
          accounts: {
            oauth2: { initTokenClient },
          },
        },
      },
    });

    const response = await requestGoogleAccessToken({
      clientId: "client.apps.googleusercontent.com",
      scope: "openid email",
      prompt: "",
      loginHint: "michele@ghosttiming.com",
    });

    expect(response.access_token).toBe("ya29.from-gis");
    expect(initTokenClient).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: "client.apps.googleusercontent.com",
        prompt: "",
        login_hint: "michele@ghosttiming.com",
      }),
    );
    expect(requestAccessToken).toHaveBeenCalledWith({
      prompt: "",
      login_hint: "michele@ghosttiming.com",
    });
  });
});
