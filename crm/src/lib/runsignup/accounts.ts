import "server-only";

import { getPool } from "@/db";
import { encryptSecret, decryptSecret } from "@/lib/google/token-crypto";
import {
  fetchRunSignupRace,
  searchRunSignupRaces,
  type RunSignupRace,
} from "@/lib/crm/runsignup";
import {
  profileFromRunSignupAccessToken,
  readRunSignupProfile,
  runSignupRaceMatchesName,
  isUnpublishedRunSignupRace,
  type RunSignupProfile,
} from "@/lib/crm/runsignup-private";
import {
  refreshRunSignupAccessToken,
  type RunSignupTokenSet,
} from "@/lib/runsignup/oauth";

const ACCESS_TOKEN_SKEW_MS = 120_000;

export type RunSignupAccountSummary = {
  id: string;
  email: string | null;
  display_name: string | null;
  status: string;
  last_error: string | null;
  connected_at: string;
};

type TokenRow = {
  id: string;
  access_token_ciphertext: string | null;
  refresh_token_ciphertext: string | null;
  access_token_expires_at: string | null;
};

async function runSignupGetProfile(accessToken: string) {
  const fromToken = profileFromRunSignupAccessToken(accessToken);
  if (fromToken) return fromToken;
  const paths = ["user"];
  for (const path of paths) {
    try {
      const url = new URL(`https://runsignup.com/Rest/${path}`);
      url.searchParams.set("format", "json");
      const response = await fetch(url, {
        headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      if (!response.ok) continue;
      const payload = (await response.json().catch(() => null)) as unknown;
      const profile = readRunSignupProfile(payload);
      if (profile) return profile;
    } catch {
      // Try the next identity endpoint.
    }
  }
  return null;
}

export async function listRunSignupAccounts() {
  await repairStaleEncryptionKeyFailures();
  const result = await getPool().query<RunSignupAccountSummary>(
    `
      SELECT id::text, email, display_name, status, last_error, connected_at::text
      FROM crm.runsignup_accounts
      WHERE status <> 'disconnected'
      ORDER BY connected_at ASC
    `,
  );
  return result.rows;
}

/**
 * Yesterday's RunSignUp search briefly hit a build-time-empty encryption key and
 * stamped accounts "expired" even though the tokens are still valid. If decrypt
 * works now, clear that stale failure so Settings stops showing a fake outage.
 */
async function repairStaleEncryptionKeyFailures() {
  const result = await getPool().query<TokenRow & { last_error: string | null }>(
    `
      SELECT id::text, access_token_ciphertext, refresh_token_ciphertext,
             access_token_expires_at::text, last_error
      FROM crm.runsignup_accounts
      WHERE status = 'expired'
        AND refresh_token_ciphertext IS NOT NULL
        AND last_error ILIKE '%GOOGLE_TOKEN_ENCRYPTION_KEY%'
    `,
  );
  for (const row of result.rows) {
    try {
      await accessTokenFor(row);
      await markAccount(row.id, "connected", null);
    } catch {
      // Still broken — leave the expired row alone.
    }
  }
}

export async function saveRunSignupAccount(input: {
  connectedByUserId: string;
  tokens: RunSignupTokenSet;
  profile?: RunSignupProfile | null;
}) {
  const profile =
    input.profile ??
    input.tokens.profile ??
    (await runSignupGetProfile(input.tokens.accessToken));
  if (!profile) {
    throw new Error(
      "RunSignUp did not identify this account. Connect again, or ask RunSignUp which profile call this app should use.",
    );
  }
  const accessCipher = encryptSecret(input.tokens.accessToken);
  const refreshCipher = input.tokens.refreshToken
    ? encryptSecret(input.tokens.refreshToken)
    : null;
  if (!refreshCipher) {
    const existing = await getPool().query<{ refresh_token_ciphertext: string | null }>(
      `
        SELECT refresh_token_ciphertext
        FROM crm.runsignup_accounts
        WHERE runsignup_user_id = $1
        LIMIT 1
      `,
      [profile.userId],
    );
    if (!existing.rows[0]?.refresh_token_ciphertext) {
      throw new Error(
        "RunSignUp did not return a lasting sign-in. Click Connect RunSignUp again and accept access.",
      );
    }
  }
  const expiresAt = new Date(Date.now() + input.tokens.expiresIn * 1000);
  await getPool().query(
    `
      INSERT INTO crm.runsignup_accounts (
        runsignup_user_id, email, display_name, status, last_error,
        access_token_ciphertext, refresh_token_ciphertext, access_token_expires_at,
        granted_scopes, connected_by_user_id, connected_at, updated_at
      )
      VALUES (
        $1, $2, $3, 'connected', NULL, $4, $5, $6::timestamptz, $7, $8::uuid, now(), now()
      )
      ON CONFLICT (runsignup_user_id) DO UPDATE SET
        email = COALESCE(EXCLUDED.email, crm.runsignup_accounts.email),
        display_name = COALESCE(EXCLUDED.display_name, crm.runsignup_accounts.display_name),
        status = 'connected',
        last_error = NULL,
        access_token_ciphertext = EXCLUDED.access_token_ciphertext,
        refresh_token_ciphertext = COALESCE(
          EXCLUDED.refresh_token_ciphertext,
          crm.runsignup_accounts.refresh_token_ciphertext
        ),
        access_token_expires_at = EXCLUDED.access_token_expires_at,
        granted_scopes = COALESCE(EXCLUDED.granted_scopes, crm.runsignup_accounts.granted_scopes),
        connected_by_user_id = EXCLUDED.connected_by_user_id,
        updated_at = now()
    `,
    [
      profile.userId,
      profile.email,
      profile.name,
      accessCipher,
      refreshCipher,
      expiresAt.toISOString(),
      input.tokens.scope ?? null,
      input.connectedByUserId,
    ],
  );
  return profile;
}

async function markAccount(id: string, status: "expired" | "connected", lastError: string | null) {
  await getPool().query(
    `
      UPDATE crm.runsignup_accounts
      SET status = $2,
          last_error = $3,
          updated_at = now()
      WHERE id = $1::uuid
    `,
    [id, status, lastError?.slice(0, 500) ?? null],
  );
}

async function accessTokenFor(row: TokenRow) {
  if (
    row.access_token_ciphertext &&
    row.access_token_expires_at &&
    Date.parse(row.access_token_expires_at) - ACCESS_TOKEN_SKEW_MS > Date.now()
  ) {
    return decryptSecret(row.access_token_ciphertext);
  }
  if (!row.refresh_token_ciphertext) {
    throw new Error("This RunSignUp account needs to be connected again.");
  }
  const tokens = await refreshRunSignupAccessToken(decryptSecret(row.refresh_token_ciphertext));
  const accessCipher = encryptSecret(tokens.accessToken);
  const refreshCipher = tokens.refreshToken
    ? encryptSecret(tokens.refreshToken)
    : row.refresh_token_ciphertext;
  const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);
  await getPool().query(
    `
      UPDATE crm.runsignup_accounts
      SET status = 'connected',
          last_error = NULL,
          access_token_ciphertext = $2,
          refresh_token_ciphertext = $3,
          access_token_expires_at = $4::timestamptz,
          granted_scopes = COALESCE($5, granted_scopes),
          updated_at = now()
      WHERE id = $1::uuid
    `,
    [row.id, accessCipher, refreshCipher, expiresAt.toISOString(), tokens.scope ?? null],
  );
  return tokens.accessToken;
}

export async function listRunSignupAccessTokens() {
  const result = await getPool().query<TokenRow>(
    `
      SELECT id::text, access_token_ciphertext, refresh_token_ciphertext,
             access_token_expires_at::text
      FROM crm.runsignup_accounts
      WHERE status = 'connected'
        AND refresh_token_ciphertext IS NOT NULL
      ORDER BY connected_at ASC
    `,
  );
  const tokens: string[] = [];
  for (const row of result.rows) {
    try {
      tokens.push(await accessTokenFor(row));
    } catch (error) {
      const message = error instanceof Error ? error.message : "RunSignUp sign-in expired.";
      await markAccount(row.id, "expired", message);
    }
  }
  return tokens;
}

export async function searchLinkedRunSignupRaces(name: string) {
  const tokens = await listRunSignupAccessTokens();
  const races: RunSignupRace[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    try {
      const found = await searchRunSignupRaces(name, 25, { accessToken: token });
      for (const race of found) {
        const id = String(race.race_id);
        if (seen.has(id) || !runSignupRaceMatchesName(race, name)) continue;
        seen.add(id);
        races.push(race);
      }
    } catch {
      // One account failing should not hide races from the other accounts.
    }
  }
  return races;
}

export async function fetchRunSignupRaceForCrm(raceId: string) {
  try {
    const race = await fetchRunSignupRace(raceId);
    if (race) return { race, unpublished: isUnpublishedRunSignupRace(race) };
  } catch {
    // A private race is not on the public endpoint. Try linked accounts next.
  }
  const tokens = await listRunSignupAccessTokens();
  for (const token of tokens) {
    try {
      const race = await fetchRunSignupRace(raceId, { accessToken: token });
      if (race) return { race, unpublished: true };
    } catch {
      // Try the next linked account.
    }
  }
  return null;
}

export async function disconnectRunSignupAccount(accountId: string) {
  await getPool().query(
    `
      UPDATE crm.runsignup_accounts
      SET status = 'disconnected',
          last_error = NULL,
          access_token_ciphertext = NULL,
          refresh_token_ciphertext = NULL,
          access_token_expires_at = NULL,
          updated_at = now()
      WHERE id = $1::uuid
    `,
    [accountId],
  );
}
