const STORAGE_PREFIX = "ghosttiming.google.session.";

export type StoredGoogleToken = {
  googleSub: string;
  accessToken: string;
  expiresAt: number;
  scope?: string;
};

export type GoogleConnectionHint = {
  google_sub: string;
  google_email: string;
  gmail_status: string;
  calendar_status: string;
};

function storageKey(userId: string) {
  return `${STORAGE_PREFIX}${userId}`;
}

export function readStoredGoogleToken(userId: string): StoredGoogleToken | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredGoogleToken;
    if (!parsed.accessToken || !parsed.googleSub || !parsed.expiresAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeStoredGoogleToken(userId: string, token: StoredGoogleToken) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(token));
  } catch {
    // Ignore quota / private-mode failures; the in-memory token still works.
  }
}

export function clearStoredGoogleToken(userId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey(userId));
  } catch {
    // Ignore storage access failures.
  }
}

export function googleTokenIsFresh(token: StoredGoogleToken, skewMs = 30_000) {
  return token.expiresAt - skewMs > Date.now();
}

export function storedTokenFromResponse(
  googleSub: string,
  accessToken: string,
  expiresIn?: number,
  scope?: string,
): StoredGoogleToken {
  const seconds = expiresIn && expiresIn > 0 ? expiresIn : 3600;
  return {
    googleSub,
    accessToken,
    expiresAt: Date.now() + seconds * 1000,
    scope,
  };
}

export function isRestorableGoogleConnection(connection: GoogleConnectionHint) {
  return (
    connection.gmail_status !== "disconnected" ||
    connection.calendar_status !== "disconnected"
  );
}

export function restorableGoogleConnections(connections: GoogleConnectionHint[]) {
  return connections.filter(isRestorableGoogleConnection);
}

export function googleLoginHint(
  stored: StoredGoogleToken | null,
  connections: GoogleConnectionHint[],
) {
  const restorable = restorableGoogleConnections(connections);
  if (!restorable.length) return null;
  const matched = stored
    ? restorable.find((row) => row.google_sub === stored.googleSub)
    : undefined;
  return (matched ?? restorable[0]).google_email;
}

export function canHydrateStoredGoogleToken(
  stored: StoredGoogleToken | null,
  connections: GoogleConnectionHint[],
) {
  if (!stored || !googleTokenIsFresh(stored)) return false;
  return restorableGoogleConnections(connections).some(
    (row) => row.google_sub === stored.googleSub,
  );
}

/** CRM sign-out and stale tokens must not wipe a known Google grant. */
export function shouldClearStoredGoogleTokenOnRestore(
  stored: StoredGoogleToken | null,
  connections: GoogleConnectionHint[],
) {
  if (!stored) return false;
  return !restorableGoogleConnections(connections).some(
    (row) => row.google_sub === stored.googleSub,
  );
}
