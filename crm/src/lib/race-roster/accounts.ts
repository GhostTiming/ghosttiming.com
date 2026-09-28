import "server-only";

import { getPool } from "@/db";
import { encryptSecret, decryptSecret } from "@/lib/google/token-crypto";
import {
  authorizeRaceRoster,
  raceRosterClientConfigured,
  readRaceRosterClientFromEnv,
} from "./auth";
import type { RaceRosterCredentials, RaceRosterTokenResponse } from "./types";

export type RaceRosterAccountSummary = {
  id: string;
  username: string;
  display_name: string | null;
  status: string;
  last_error: string | null;
  connected_at: string;
};

type TokenRow = {
  id: string;
  username: string;
  access_token_ciphertext: string | null;
  refresh_token_ciphertext: string | null;
  access_token_expires_at: string | null;
};

const ACCESS_TOKEN_SKEW_MS = 120_000;

export function raceRosterConnectConfigured() {
  return raceRosterClientConfigured();
}

export async function listRaceRosterAccounts() {
  const result = await getPool().query<RaceRosterAccountSummary>(
    `
      SELECT id::text, username, display_name, status, last_error, connected_at::text
      FROM crm.race_roster_accounts
      WHERE status <> 'disconnected'
      ORDER BY connected_at ASC
    `,
  );
  return result.rows;
}

export async function connectRaceRosterAccount(input: {
  connectedByUserId: string;
  username: string;
  password: string;
}) {
  const client = readRaceRosterClientFromEnv();
  const username = input.username.trim();
  const password = input.password;
  if (!username || !password) {
    throw new Error("Enter the Race Roster timer account email and password.");
  }

  const tokens = await authorizeRaceRoster({
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    username,
    password,
  });
  if (!tokens.refresh_token) {
    throw new Error(
      "Race Roster did not return a lasting sign-in. Check the timer account password and try again.",
    );
  }

  await saveRaceRosterTokens({
    username,
    displayName: username,
    connectedByUserId: input.connectedByUserId,
    tokens,
  });
}

async function saveRaceRosterTokens(input: {
  username: string;
  displayName?: string | null;
  connectedByUserId: string;
  tokens: RaceRosterTokenResponse;
}) {
  const accessCipher = encryptSecret(input.tokens.access_token);
  const refreshCipher = input.tokens.refresh_token
    ? encryptSecret(input.tokens.refresh_token)
    : null;
  if (!refreshCipher) {
    throw new Error("Race Roster did not return a lasting sign-in token.");
  }
  const expiresAt = new Date(Date.now() + input.tokens.expires_in * 1000);
  await getPool().query(
    `
      INSERT INTO crm.race_roster_accounts (
        username, display_name, status, last_error,
        access_token_ciphertext, refresh_token_ciphertext, access_token_expires_at,
        connected_by_user_id, connected_at, updated_at
      )
      VALUES (
        $1, $2, 'connected', NULL, $3, $4, $5::timestamptz, $6::uuid, now(), now()
      )
      ON CONFLICT (username) DO UPDATE SET
        display_name = COALESCE(EXCLUDED.display_name, crm.race_roster_accounts.display_name),
        status = 'connected',
        last_error = NULL,
        access_token_ciphertext = EXCLUDED.access_token_ciphertext,
        refresh_token_ciphertext = COALESCE(
          EXCLUDED.refresh_token_ciphertext,
          crm.race_roster_accounts.refresh_token_ciphertext
        ),
        access_token_expires_at = EXCLUDED.access_token_expires_at,
        connected_by_user_id = EXCLUDED.connected_by_user_id,
        updated_at = now()
    `,
    [
      input.username,
      input.displayName ?? input.username,
      accessCipher,
      refreshCipher,
      expiresAt.toISOString(),
      input.connectedByUserId,
    ],
  );
}

export async function disconnectRaceRosterAccount(accountId: string) {
  await getPool().query(
    `
      UPDATE crm.race_roster_accounts
      SET status = 'disconnected',
          access_token_ciphertext = NULL,
          refresh_token_ciphertext = NULL,
          access_token_expires_at = NULL,
          last_error = NULL,
          updated_at = now()
      WHERE id = $1::uuid
    `,
    [accountId],
  );
}

async function markAccount(id: string, status: "expired" | "connected", lastError: string | null) {
  await getPool().query(
    `
      UPDATE crm.race_roster_accounts
      SET status = $2,
          last_error = $3,
          updated_at = now()
      WHERE id = $1::uuid
    `,
    [id, status, lastError?.slice(0, 500) ?? null],
  );
}

/**
 * Prefer a linked Settings account; fall back to env username/password/refresh.
 */
export async function resolveRaceRosterCredentials(): Promise<RaceRosterCredentials> {
  const client = readRaceRosterClientFromEnv();
  const linked = await getPool().query<TokenRow>(
    `
      SELECT id::text, username, access_token_ciphertext, refresh_token_ciphertext,
             access_token_expires_at::text
      FROM crm.race_roster_accounts
      WHERE status = 'connected'
        AND refresh_token_ciphertext IS NOT NULL
      ORDER BY connected_at ASC
      LIMIT 1
    `,
  );
  const row = linked.rows[0];
  if (row?.refresh_token_ciphertext) {
    try {
      const refreshToken = decryptSecret(row.refresh_token_ciphertext);
      return {
        clientId: client.clientId,
        clientSecret: client.clientSecret,
        refreshToken,
        username: row.username,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Race Roster token unlock failed.";
      await markAccount(row.id, "expired", message);
    }
  }

  return {
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    username: process.env["RACE_ROSTER_USERNAME"]?.trim() || undefined,
    password: process.env["RACE_ROSTER_PASSWORD"]?.trim() || undefined,
    refreshToken: process.env["RACE_ROSTER_REFRESH_TOKEN"]?.trim() || undefined,
    clientName: process.env["RACE_ROSTER_CLIENT_NAME"]?.trim() || undefined,
  };
}

export async function persistRaceRosterRefreshToken(
  username: string | undefined,
  tokens: RaceRosterTokenResponse,
) {
  if (!username || !tokens.refresh_token) return;
  const accessCipher = encryptSecret(tokens.access_token);
  const refreshCipher = encryptSecret(tokens.refresh_token);
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  await getPool().query(
    `
      UPDATE crm.race_roster_accounts
      SET status = 'connected',
          last_error = NULL,
          access_token_ciphertext = $2,
          refresh_token_ciphertext = $3,
          access_token_expires_at = $4::timestamptz,
          updated_at = now()
      WHERE username = $1
        AND status <> 'disconnected'
    `,
    [username, accessCipher, refreshCipher, expiresAt.toISOString()],
  );
}

export async function raceRosterAccessTokenSkewOk(expiresAt: string | null | undefined) {
  if (!expiresAt) return false;
  return Date.parse(expiresAt) - ACCESS_TOKEN_SKEW_MS > Date.now();
}
