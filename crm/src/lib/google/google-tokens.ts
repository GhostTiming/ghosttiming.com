import { getPool } from "@/db";
import { listGoogleCalendars } from "@/lib/google/calendar-api";
import { getGoogleUserInfo } from "@/lib/google/google-fetch";
import {
  refreshGoogleAccessToken,
  revokeGoogleToken,
  type GoogleTokenSet,
} from "@/lib/google/oauth";
import { decryptSecret, encryptSecret } from "@/lib/google/token-crypto";

const ACCESS_TOKEN_SKEW_MS = 120_000;
const refreshLocks = new Map<string, Promise<GoogleSessionToken>>();

export type GoogleTokenRow = {
  id: string;
  google_sub: string;
  google_email: string;
  calendar_id: string | null;
  calendar_summary: string | null;
  google_refresh_token_ciphertext: string | null;
  google_access_token_ciphertext: string | null;
  google_access_token_expires_at: string | null;
  google_granted_scopes: string | null;
};

export type GoogleSessionToken = {
  accessToken: string;
  expiresAt: number;
  googleSub: string;
  googleEmail: string;
  scope: string | null;
};

function lockKey(userId: string, googleSub?: string | null) {
  return `${userId}:${googleSub ?? ""}`;
}

export async function loadGoogleTokenRow(userId: string, googleSub?: string | null) {
  const result = await getPool().query<GoogleTokenRow>(
    `
      SELECT id::text, google_sub, google_email, calendar_id, calendar_summary,
             google_refresh_token_ciphertext, google_access_token_ciphertext,
             google_access_token_expires_at::text, google_granted_scopes
      FROM crm.google_connections
      WHERE user_id = $1::uuid
        AND ($2::text IS NULL OR google_sub = $2)
        AND (
          gmail_status <> 'disconnected'
          OR calendar_status <> 'disconnected'
          OR google_refresh_token_ciphertext IS NOT NULL
        )
      ORDER BY CASE WHEN google_refresh_token_ciphertext IS NOT NULL THEN 0 ELSE 1 END,
               connected_at ASC
      LIMIT 1
    `,
    [userId, googleSub ?? null],
  );
  return result.rows[0] ?? null;
}

export async function saveGoogleOAuthGrant(input: {
  userId: string;
  googleSub: string;
  googleEmail: string;
  tokens: GoogleTokenSet;
  calendarId?: string | null;
  calendarSummary?: string | null;
  existingRefreshCiphertext?: string | null;
}) {
  if (!input.tokens.refreshToken && !input.existingRefreshCiphertext) {
    throw new Error(
      "Google did not return a lasting sign-in key. Click Connect Google again and accept every permission.",
    );
  }
  const grantedGmail = input.tokens.scope?.includes("gmail") ?? true;
  const grantedCalendar = input.tokens.scope?.includes("calendar") ?? true;
  const refreshCipher = input.tokens.refreshToken
    ? encryptSecret(input.tokens.refreshToken)
    : input.existingRefreshCiphertext;
  if (!refreshCipher) {
    throw new Error(
      "Google did not return a lasting sign-in key. Click Connect Google again and accept every permission.",
    );
  }
  const accessCipher = encryptSecret(input.tokens.accessToken);
  const expiresAt = new Date(Date.now() + input.tokens.expiresIn * 1000);
  await getPool().query(
    `
      INSERT INTO crm.google_connections (
        user_id, google_sub, google_email, gmail_status, calendar_status,
        calendar_id, calendar_summary, google_refresh_token_ciphertext,
        google_access_token_ciphertext, google_access_token_expires_at,
        google_granted_scopes, gmail_last_error, calendar_last_error,
        connected_at, updated_at
      )
      VALUES (
        $1::uuid, $2, $3,
        CASE WHEN $4 THEN 'connected'::crm.google_connection_status ELSE 'error'::crm.google_connection_status END,
        CASE WHEN $5 THEN 'connected'::crm.google_connection_status ELSE 'error'::crm.google_connection_status END,
        $6, $7, $8, $9, $10::timestamptz, $11,
        CASE WHEN $4 THEN NULL ELSE 'Gmail permission was not granted.' END,
        CASE WHEN $5 THEN NULL ELSE 'Calendar permission was not granted.' END,
        now(), now()
      )
      ON CONFLICT (user_id, google_sub) DO UPDATE SET
        google_email = EXCLUDED.google_email,
        gmail_status = EXCLUDED.gmail_status,
        calendar_status = EXCLUDED.calendar_status,
        calendar_id = COALESCE(EXCLUDED.calendar_id, crm.google_connections.calendar_id),
        calendar_summary = COALESCE(EXCLUDED.calendar_summary, crm.google_connections.calendar_summary),
        google_refresh_token_ciphertext = EXCLUDED.google_refresh_token_ciphertext,
        google_access_token_ciphertext = EXCLUDED.google_access_token_ciphertext,
        google_access_token_expires_at = EXCLUDED.google_access_token_expires_at,
        google_granted_scopes = EXCLUDED.google_granted_scopes,
        gmail_last_error = EXCLUDED.gmail_last_error,
        calendar_last_error = EXCLUDED.calendar_last_error,
        updated_at = now()
    `,
    [
      input.userId,
      input.googleSub,
      input.googleEmail.toLowerCase(),
      grantedGmail,
      grantedCalendar,
      input.calendarId ?? null,
      input.calendarSummary ?? null,
      refreshCipher,
      accessCipher,
      expiresAt.toISOString(),
      input.tokens.scope ?? null,
    ],
  );
}

async function persistRefreshedTokens(row: GoogleTokenRow, tokens: GoogleTokenSet) {
  const refreshCipher = tokens.refreshToken
    ? encryptSecret(tokens.refreshToken)
    : row.google_refresh_token_ciphertext;
  const accessCipher = encryptSecret(tokens.accessToken);
  const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);
  await getPool().query(
    `
      UPDATE crm.google_connections
      SET google_refresh_token_ciphertext = $2,
          google_access_token_ciphertext = $3,
          google_access_token_expires_at = $4::timestamptz,
          google_granted_scopes = COALESCE($5, google_granted_scopes),
          gmail_status = CASE
            WHEN gmail_status = 'expired' THEN 'connected'::crm.google_connection_status
            ELSE gmail_status END,
          calendar_status = CASE
            WHEN calendar_status = 'expired' THEN 'connected'::crm.google_connection_status
            ELSE calendar_status END,
          gmail_last_error = NULL,
          calendar_last_error = NULL,
          updated_at = now()
      WHERE id = $1::uuid
    `,
    [
      row.id,
      refreshCipher,
      accessCipher,
      expiresAt.toISOString(),
      tokens.scope ?? null,
    ],
  );
  return {
    accessToken: tokens.accessToken,
    expiresAt: expiresAt.getTime(),
    googleSub: row.google_sub,
    googleEmail: row.google_email,
    scope: tokens.scope ?? row.google_granted_scopes,
  } satisfies GoogleSessionToken;
}

export class GoogleNeedsReauthError extends Error {
  needsReauth = true as const;
  constructor(message = "Connect Google once more so the CRM can stay signed in.") {
    super(message);
  }
}

async function refreshLocked(row: GoogleTokenRow): Promise<GoogleSessionToken> {
  if (!row.google_refresh_token_ciphertext) {
    throw new GoogleNeedsReauthError();
  }
  const refreshToken = decryptSecret(row.google_refresh_token_ciphertext);
  try {
    const tokens = await refreshGoogleAccessToken(refreshToken);
    return persistRefreshedTokens(row, tokens);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google refresh failed.";
    const invalidGrant = /invalid_grant|invalid refresh/i.test(message);
    await getPool().query(
      `
        UPDATE crm.google_connections
        SET gmail_status = 'expired',
            calendar_status = 'expired',
            gmail_last_error = $2,
            calendar_last_error = $2,
            google_refresh_token_ciphertext = CASE WHEN $3 THEN NULL ELSE google_refresh_token_ciphertext END,
            google_access_token_ciphertext = CASE WHEN $3 THEN NULL ELSE google_access_token_ciphertext END,
            google_access_token_expires_at = CASE WHEN $3 THEN NULL ELSE google_access_token_expires_at END,
            updated_at = now()
        WHERE id = $1::uuid
      `,
      [row.id, message, invalidGrant],
    );
    throw new GoogleNeedsReauthError(
      "Google sign-in expired. Click Connect Google once to restore the lasting link.",
    );
  }
}

export async function getGoogleSessionToken(
  userId: string,
  googleSub?: string | null,
): Promise<GoogleSessionToken> {
  const row = await loadGoogleTokenRow(userId, googleSub);
  if (!row) {
    throw new GoogleNeedsReauthError("Connect Google to use Gmail and Calendar.");
  }
  if (
    row.google_access_token_ciphertext &&
    row.google_access_token_expires_at &&
    Date.parse(row.google_access_token_expires_at) - ACCESS_TOKEN_SKEW_MS > Date.now()
  ) {
    return {
      accessToken: decryptSecret(row.google_access_token_ciphertext),
      expiresAt: Date.parse(row.google_access_token_expires_at),
      googleSub: row.google_sub,
      googleEmail: row.google_email,
      scope: row.google_granted_scopes,
    };
  }
  const key = lockKey(userId, row.google_sub);
  const pending = refreshLocks.get(key);
  if (pending) return pending;
  const work = refreshLocked(row).finally(() => {
    refreshLocks.delete(key);
  });
  refreshLocks.set(key, work);
  return work;
}

export async function completeGoogleOAuthLogin(input: {
  userId: string;
  tokens: GoogleTokenSet;
}) {
  const userInfo = await getGoogleUserInfo(input.tokens.accessToken);
  const calendars = input.tokens.scope?.includes("calendar")
    ? await listGoogleCalendars(input.tokens.accessToken).catch(() => [])
    : [];
  const existing = await loadGoogleTokenRow(input.userId, userInfo.sub);
  const selected =
    existing?.calendar_id && calendars.some((item) => item.id === existing.calendar_id)
      ? calendars.find((item) => item.id === existing.calendar_id)
      : calendars.find((item) => item.primary) ?? calendars[0];
  await saveGoogleOAuthGrant({
    userId: input.userId,
    googleSub: userInfo.sub,
    googleEmail: userInfo.email,
    tokens: input.tokens,
    calendarId: selected?.id ?? existing?.calendar_id ?? null,
    calendarSummary: selected?.summary ?? existing?.calendar_summary ?? null,
    existingRefreshCiphertext: existing?.google_refresh_token_ciphertext,
  });
  return {
    googleSub: userInfo.sub,
    googleEmail: userInfo.email,
    calendarId: selected?.id ?? null,
    calendarSummary: selected?.summary ?? null,
  };
}

export async function disconnectGoogleOfflineGrant(userId: string, googleSub?: string | null) {
  const row = await loadGoogleTokenRow(userId, googleSub);
  if (row?.google_refresh_token_ciphertext) {
    try {
      await revokeGoogleToken(decryptSecret(row.google_refresh_token_ciphertext));
    } catch {
      // Still disconnect locally if Google revoke is unavailable.
    }
  } else if (row?.google_access_token_ciphertext) {
    try {
      await revokeGoogleToken(decryptSecret(row.google_access_token_ciphertext));
    } catch {
      // Ignore revoke failures.
    }
  }
  await getPool().query(
    `
      UPDATE crm.google_connections
      SET gmail_status = 'disconnected',
          calendar_status = 'disconnected',
          gmail_last_error = NULL,
          calendar_last_error = NULL,
          google_refresh_token_ciphertext = NULL,
          google_access_token_ciphertext = NULL,
          google_access_token_expires_at = NULL,
          google_granted_scopes = NULL,
          updated_at = now()
      WHERE user_id = $1::uuid
        AND ($2::text IS NULL OR google_sub = $2)
    `,
    [userId, googleSub ?? null],
  );
}
