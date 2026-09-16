export class GoogleAuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export class GoogleQuotaError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export const GMAIL_MIN_REQUEST_INTERVAL_MS = 80;
export const GMAIL_QUOTA_RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000, 60_000];

type QuotaWaitHandler = (info: { delayMs: number; attempt: number }) => void;

let quotaWaitHandler: QuotaWaitHandler | null = null;
let nextGmailRequestAt = 0;

export function setGoogleQuotaWaitHandler(handler: QuotaWaitHandler | null) {
  quotaWaitHandler = handler;
}

export function resetGoogleFetchStateForTests() {
  nextGmailRequestAt = 0;
  quotaWaitHandler = null;
}

export function isGoogleQuotaError(status: number, message: string, googleStatus?: string) {
  if (status === 429) return true;
  if (status !== 403) return false;
  const text = `${message} ${googleStatus ?? ""}`.toLowerCase();
  return (
    text.includes("quota") ||
    text.includes("ratelimit") ||
    text.includes("rate limit") ||
    text.includes("resource_exhausted")
  );
}

export function gmailQuotaUserMessage(message?: string) {
  return (
    message?.trim() ||
    "Gmail’s per-minute limit was reached. Wait a minute and sync again; already-imported mail is kept."
  );
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function retryAfterMs(response: Response, attempt: number) {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(Math.max(seconds * 1000, 1_000), 120_000);
    }
    const until = Date.parse(header);
    if (Number.isFinite(until)) {
      return Math.min(Math.max(until - Date.now(), 1_000), 120_000);
    }
  }
  return GMAIL_QUOTA_RETRY_DELAYS_MS[
    Math.min(attempt, GMAIL_QUOTA_RETRY_DELAYS_MS.length - 1)
  ];
}

async function paceGmail(url: string) {
  if (!url.includes("gmail.googleapis.com")) return;
  const wait = nextGmailRequestAt - Date.now();
  if (wait > 0) await sleep(wait);
  nextGmailRequestAt = Date.now() + GMAIL_MIN_REQUEST_INTERVAL_MS;
}

export type GoogleFetchInit = RequestInit;

export async function googleFetch<T>(
  accessToken: string,
  url: string,
  init?: GoogleFetchInit,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    await paceGmail(url);
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
    if (response.status === 204) return undefined as T;
    const payload = (await response.json().catch(() => null)) as
      | { error?: { message?: string; status?: string } }
      | T
      | null;
    if (response.ok) return payload as T;

    const googleStatus =
      payload && typeof payload === "object" && "error" in payload
        ? payload.error?.status
        : undefined;
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? payload.error?.message || payload.error?.status || response.statusText
        : response.statusText;
    const errorMessage = message || "Google API request failed.";

    if (
      isGoogleQuotaError(response.status, errorMessage, googleStatus) &&
      attempt < GMAIL_QUOTA_RETRY_DELAYS_MS.length
    ) {
      const delayMs = retryAfterMs(response, attempt);
      quotaWaitHandler?.({ delayMs, attempt: attempt + 1 });
      await sleep(delayMs);
      continue;
    }

    if (isGoogleQuotaError(response.status, errorMessage, googleStatus)) {
      throw new GoogleQuotaError(
        gmailQuotaUserMessage(
          "Gmail’s per-minute limit was reached. Wait a minute and sync again; already-imported mail is kept.",
        ),
        response.status,
      );
    }

    throw new GoogleAuthError(errorMessage, response.status);
  }
}

export type GoogleUserInfo = {
  sub: string;
  email: string;
  name?: string;
};

export function getGoogleUserInfo(accessToken: string) {
  return googleFetch<GoogleUserInfo>(
    accessToken,
    "https://www.googleapis.com/oauth2/v3/userinfo",
  );
}
