export type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

export type GoogleTokenClientOverride = {
  prompt?: string;
  login_hint?: string;
};

export type GoogleTokenClient = {
  requestAccessToken: (override?: GoogleTokenClientOverride) => void;
  callback?: (response: GoogleTokenResponse) => void;
};

type GoogleTokenClientConfig = {
  client_id: string;
  scope: string;
  prompt?: string;
  login_hint?: string;
  callback: (response: GoogleTokenResponse) => void;
  error_callback?: (error: { type?: string; message?: string }) => void;
};

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: GoogleTokenClientConfig) => GoogleTokenClient;
          hasGrantedAllScopes: (
            response: GoogleTokenResponse,
            ...scopes: string[]
          ) => boolean;
          hasGrantedAnyScope: (
            response: GoogleTokenResponse,
            ...scopes: string[]
          ) => boolean;
          revoke: (token: string, done?: (result: { successful: boolean }) => void) => void;
        };
      };
    };
  }
}

export function isGisReady() {
  return Boolean(window.google?.accounts?.oauth2?.initTokenClient);
}

export function waitForGis(timeoutMs = 15_000) {
  if (isGisReady()) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (isGisReady()) {
        window.clearInterval(timer);
        resolve();
        return;
      }
      if (Date.now() - started > timeoutMs) {
        window.clearInterval(timer);
        reject(new Error("Google Identity Services did not load."));
      }
    }, 50);
  });
}

function popupErrorMessage(type?: string, message?: string) {
  if (type === "popup_failed_to_open") {
    return "Google could not open the sign-in popup. Allow popups for this site, then click Connect Google again. If you are inside Cursor's preview browser, open http://localhost:3001 in Chrome or Edge instead.";
  }
  if (type === "popup_closed") {
    return "Google sign-in was closed before it finished. Click Connect Google and complete the popup.";
  }
  return message || type || "Google authorization was cancelled.";
}

export async function requestGoogleAccessToken(input: {
  clientId: string;
  scope: string;
  prompt?: "" | "consent" | "select_account";
  loginHint?: string;
}) {
  if (!isGisReady()) {
    throw new Error("Google sign-in is still loading. Wait a second, then click Connect Google again.");
  }
  const oauth = window.google!.accounts.oauth2;
  const prompt = input.prompt ?? "select_account";
  const loginHint = input.loginHint?.trim() || undefined;
  return new Promise<GoogleTokenResponse>((resolve, reject) => {
    const client = oauth.initTokenClient({
      client_id: input.clientId,
      scope: input.scope,
      prompt,
      ...(loginHint ? { login_hint: loginHint } : {}),
      callback: (response) => {
        if (response.error) {
          reject(new Error(response.error_description || response.error));
          return;
        }
        resolve(response);
      },
      error_callback: (error) => {
        reject(new Error(popupErrorMessage(error.type, error.message)));
      },
    });
    client.requestAccessToken({
      prompt,
      ...(loginHint ? { login_hint: loginHint } : {}),
    });
  });
}

export function revokeGoogleAccessToken(token: string) {
  if (!window.google?.accounts.oauth2.revoke) return;
  window.google.accounts.oauth2.revoke(token);
}
