import "server-only";

import { revalidatePath } from "next/cache";
import type { PoolClient } from "pg";
import { getPool } from "@/db";
import { isSuperAdminRole, type CrmRole } from "@/lib/auth/roles";
import { processCadenceReplies } from "@/lib/crm/cadence";
import { ingestGmailMessages } from "@/lib/crm/google-sync";
import { loadEmailMatchIndex } from "@/lib/crm/google-queries";
import {
  buildGmailAddressQuery,
  chunk,
  emailsForGmailSearch,
  matchEmailsToCrm,
  type EmailMatchTargets,
} from "@/lib/google/email-match";
import {
  getGmailMessage,
  getGmailProfile,
  listGmailHistoryMessageIds,
  listGmailMessageIdPage,
} from "@/lib/google/gmail-api";
import { parseGmailMessage } from "@/lib/google/gmail-parse";
import { hasGmailReadonlyScope } from "@/lib/google/gmail-scopes";
import { GoogleAuthError, GoogleQuotaError } from "@/lib/google/google-fetch";
import {
  getGoogleSessionToken,
  GoogleNeedsReauthError,
} from "@/lib/google/google-tokens";
import { GMAIL_SEARCH_BATCH_SIZE } from "@/lib/google/scopes";
import {
  GMAIL_AUTO_SYNC_MESSAGE_CAP,
  GMAIL_AUTO_SYNC_PAGE_BUDGET,
  gmailAutoCatchupQuery,
  shouldSaveGmailCursor,
} from "@/lib/google/gmail-auto-sync-plan";

const MIN_SUCCESS_INTERVAL = "90 seconds";
const STALE_LOCK_INTERVAL = "3 minutes";

type ConnectionSyncRow = {
  id: string;
  user_id: string;
  google_sub: string;
  google_email: string;
  gmail_history_id: string | null;
  gmail_last_synced_at: string | null;
};

export type GmailAutoSyncResult = {
  createdActivities: number;
  more: boolean;
  synced: number;
  skipped: number;
  errors: string[];
};

async function withCrmTransaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function loadKnownGmailIds(googleSub: string, ids: string[]) {
  const known = new Set<string>();
  for (const batch of chunk(ids, 100)) {
    if (!batch.length) continue;
    const result = await getPool().query<{ gmail_message_id: string }>(
      `
        SELECT gmail_message_id
        FROM crm.google_email_messages
        WHERE google_sub = $1
          AND gmail_message_id = ANY($2::text[])
      `,
      [googleSub, batch],
    );
    for (const row of result.rows) known.add(row.gmail_message_id);
  }
  return known;
}

async function organizationScopeForUser(userId: string) {
  const user = await getPool().query<{ role: CrmRole }>(
    `SELECT role::text AS role FROM crm.users WHERE id = $1::uuid`,
    [userId],
  );
  const role = user.rows[0]?.role;
  if (role && isSuperAdminRole(role)) return null;
  const memberships = await getPool().query<{ organization_id: string }>(
    `
      SELECT organization_id::text
      FROM crm.user_organization_memberships
      WHERE user_id = $1::uuid
    `,
    [userId],
  );
  return memberships.rows.map((row) => row.organization_id);
}

async function claimConnection(id: string) {
  const claimed = await getPool().query<{ id: string }>(
    `
      UPDATE crm.google_connections
      SET gmail_status = 'syncing', updated_at = now()
      WHERE id = $1::uuid
        AND gmail_status <> 'disconnected'
        AND google_refresh_token_ciphertext IS NOT NULL
        AND (
          gmail_last_synced_at IS NULL
          OR gmail_last_synced_at < now() - $2::interval
        )
        AND (
          gmail_status IS DISTINCT FROM 'syncing'
          OR updated_at < now() - $3::interval
        )
      RETURNING id::text
    `,
    [id, MIN_SUCCESS_INTERVAL, STALE_LOCK_INTERVAL],
  );
  return Boolean(claimed.rows[0]);
}

async function saveCursor(id: string, historyId: string) {
  await getPool().query(
    `
      UPDATE crm.google_connections
      SET gmail_status = 'synced',
          gmail_history_id = $2,
          gmail_last_synced_at = now(),
          gmail_last_error = NULL,
          updated_at = now()
      WHERE id = $1::uuid
    `,
    [id, historyId],
  );
}

async function releaseLock(id: string, lastError: string | null = null) {
  await getPool().query(
    `
      UPDATE crm.google_connections
      SET gmail_status = 'connected',
          gmail_last_error = $2,
          updated_at = now()
      WHERE id = $1::uuid
        AND gmail_status = 'syncing'
    `,
    [id, lastError],
  );
}

async function markFailure(id: string, message: string, status: "error" | "expired") {
  await getPool().query(
    `
      UPDATE crm.google_connections
      SET gmail_status = $3::crm.google_connection_status,
          calendar_status = CASE
            WHEN $3 = 'expired' THEN 'expired'::crm.google_connection_status
            ELSE calendar_status
          END,
          gmail_last_error = $2,
          google_access_token_expires_at = CASE
            WHEN $3 = 'expired' THEN now() - interval '1 minute'
            ELSE google_access_token_expires_at
          END,
          updated_at = now()
      WHERE id = $1::uuid
        AND gmail_status <> 'disconnected'
    `,
    [id, message.slice(0, 500), status],
  );
}

async function ingestFreshMessages(input: {
  token: string;
  googleSub: string;
  googleEmail: string;
  userId: string;
  organizationIds: string[] | null;
  ids: string[];
  index: Record<string, EmailMatchTargets>;
}) {
  const known = await loadKnownGmailIds(input.googleSub, input.ids);
  const freshIds = input.ids.filter((id) => !known.has(id));
  let createdActivities = 0;
  const parsed = [];
  for (const id of freshIds) {
    const raw = await getGmailMessage(input.token, id);
    const message = parseGmailMessage(raw, input.googleEmail);
    if (!message) continue;
    const matches = matchEmailsToCrm(message.involvedEmails, input.index);
    if (
      !matches.prospectIds.length &&
      !matches.bookingIds.length &&
      !matches.organizationIds.length &&
      !matches.personIds.length
    ) {
      continue;
    }
    parsed.push({ ...message, ...matches });
  }
  for (const batch of chunk(parsed, 25)) {
    const stored = await withCrmTransaction((client) =>
      ingestGmailMessages(client, {
        googleSub: input.googleSub,
        googleEmail: input.googleEmail,
        actorUserId: input.userId,
        organizationIds: input.organizationIds,
        messages: batch,
      }),
    );
    createdActivities += stored.createdActivities;
  }
  if (parsed.length) {
    try {
      await withCrmTransaction((client) => processCadenceReplies(client));
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!/does not exist/i.test(message)) throw error;
    }
  }
  return createdActivities;
}

async function findRecentUnknownIds(input: {
  token: string;
  googleSub: string;
  querySuffix: string;
  emails: string[];
}) {
  const unknown: string[] = [];
  const seen = new Set<string>();
  let pagesScanned = 0;
  let exhausted = false;
  const cap = GMAIL_AUTO_SYNC_MESSAGE_CAP;
  const budget = GMAIL_AUTO_SYNC_PAGE_BUDGET;

  for (const addresses of chunk(input.emails, GMAIL_SEARCH_BATCH_SIZE)) {
    if (unknown.length >= cap || pagesScanned >= budget) {
      exhausted = true;
      break;
    }
    const query = `${buildGmailAddressQuery(addresses)}${input.querySuffix}`;
    let pageToken: string | undefined;
    let queryComplete = false;
    while (!queryComplete) {
      if (pagesScanned >= budget || unknown.length >= cap) {
        exhausted = true;
        break;
      }
      const page = await listGmailMessageIdPage(input.token, query, pageToken);
      pagesScanned += 1;
      if (page.ids.length) {
        const known = await loadKnownGmailIds(input.googleSub, page.ids);
        for (const id of page.ids) {
          if (known.has(id) || seen.has(id)) continue;
          seen.add(id);
          unknown.push(id);
        }
      }
      if (!page.nextPageToken) queryComplete = true;
      else pageToken = page.nextPageToken;
    }
    if (exhausted) break;
  }

  return {
    unknown,
    reachedEnd: !exhausted,
    pagesScanned,
  };
}

async function syncConnection(
  row: ConnectionSyncRow,
  organizationIds: string[] | null,
): Promise<{ createdActivities: number; more: boolean; skipped: boolean; error?: string }> {
  let session;
  try {
    session = await getGoogleSessionToken(row.user_id, row.google_sub);
  } catch (error) {
    if (error instanceof GoogleNeedsReauthError) {
      return { createdActivities: 0, more: false, skipped: false, error: error.message };
    }
    throw error;
  }
  if (session.scope && !hasGmailReadonlyScope(session.scope)) {
    await markFailure(row.id, "Gmail permission was not granted.", "error");
    return {
      createdActivities: 0,
      more: false,
      skipped: false,
      error: `${row.google_email} is missing Gmail permission.`,
    };
  }
  const claimed = await claimConnection(row.id);
  if (!claimed) return { createdActivities: 0, more: false, skipped: true };

  try {
    const entries = await loadEmailMatchIndex({ organizationIds });
    const index = Object.fromEntries(entries.map((entry) => [entry.email, entry]));
    let createdActivities = 0;
    let more = false;
    let historyId: string | null = null;

    if (row.gmail_history_id) {
      try {
        const history = await listGmailHistoryMessageIds(session.accessToken, row.gmail_history_id);
        const known = await loadKnownGmailIds(row.google_sub, history.ids);
        const unknown = history.ids.filter((id) => !known.has(id));
        const batch = unknown.slice(0, GMAIL_AUTO_SYNC_MESSAGE_CAP);
        createdActivities += await ingestFreshMessages({
          token: session.accessToken,
          googleSub: row.google_sub,
          googleEmail: row.google_email,
          userId: row.user_id,
          organizationIds,
          ids: batch,
          index,
        });
        more = unknown.length > GMAIL_AUTO_SYNC_MESSAGE_CAP;
        historyId = more ? null : history.historyId;
      } catch (error) {
        if (!(error instanceof GoogleAuthError) || error.status !== 404) throw error;
      }
    }

    const historyExpired = Boolean(row.gmail_history_id) && historyId === null && !more;
    if (!row.gmail_history_id || historyExpired) {
      const emails = emailsForGmailSearch(index);
      if (!emails.length) {
        historyId = (await getGmailProfile(session.accessToken)).historyId;
        more = false;
      } else {
        const found = await findRecentUnknownIds({
          token: session.accessToken,
          googleSub: row.google_sub,
          querySuffix: gmailAutoCatchupQuery(row.gmail_last_synced_at),
          emails,
        });
        const batch = found.unknown.slice(0, GMAIL_AUTO_SYNC_MESSAGE_CAP);
        createdActivities += await ingestFreshMessages({
          token: session.accessToken,
          googleSub: row.google_sub,
          googleEmail: row.google_email,
          userId: row.user_id,
          organizationIds,
          ids: batch,
          index,
        });
        const save = shouldSaveGmailCursor({
          reachedEnd: found.reachedEnd,
          pagesScanned: found.pagesScanned,
          pageBudget: GMAIL_AUTO_SYNC_PAGE_BUDGET,
          unknownCount: found.unknown.length,
          cap: GMAIL_AUTO_SYNC_MESSAGE_CAP,
        });
        more = !save;
        if (save) historyId = (await getGmailProfile(session.accessToken)).historyId;
      }
    }

    if (historyId) await saveCursor(row.id, historyId);
    else await releaseLock(row.id);
    return { createdActivities, more, skipped: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gmail sync failed.";
    if (error instanceof GoogleQuotaError) {
      await releaseLock(row.id, message);
      return { createdActivities: 0, more: false, skipped: false, error: message };
    }
    if (error instanceof GoogleAuthError && error.status === 401) {
      await getPool().query(
        `
          UPDATE crm.google_connections
          SET gmail_status = 'connected',
              gmail_last_error = $2,
              google_access_token_expires_at = now() - interval '1 minute',
              updated_at = now()
          WHERE id = $1::uuid
            AND gmail_status <> 'disconnected'
        `,
        [row.id, message.slice(0, 500)],
      );
      return { createdActivities: 0, more: true, skipped: false, error: message };
    }
    if (error instanceof GoogleAuthError && error.status === 403) {
      await markFailure(row.id, message, "expired");
    } else {
      await markFailure(row.id, message, "error");
    }
    return { createdActivities: 0, more: false, skipped: false, error: message };
  }
}

export async function syncStoredGmailAccounts(options?: {
  userId?: string | null;
  organizationIds?: string[] | null;
}): Promise<GmailAutoSyncResult> {
  const result = await getPool().query<ConnectionSyncRow>(
    `
      SELECT id::text, user_id::text, google_sub, google_email,
             gmail_history_id, gmail_last_synced_at::text
      FROM crm.google_connections
      WHERE google_refresh_token_ciphertext IS NOT NULL
        AND gmail_status <> 'disconnected'
        AND ($1::uuid IS NULL OR user_id = $1::uuid)
      ORDER BY gmail_last_synced_at NULLS FIRST, connected_at ASC
    `,
    [options?.userId ?? null],
  );

  const summary: GmailAutoSyncResult = {
    createdActivities: 0,
    more: false,
    synced: 0,
    skipped: 0,
    errors: [],
  };
  const scopes = new Map<string, string[] | null>();
  for (const row of result.rows) {
    const organizationIds =
      options?.userId &&
      row.user_id === options.userId &&
      options.organizationIds !== undefined
        ? options.organizationIds
        : await (async () => {
            const cached = scopes.get(row.user_id);
            if (cached !== undefined) return cached;
            const loaded = await organizationScopeForUser(row.user_id);
            scopes.set(row.user_id, loaded);
            return loaded;
          })();
    const synced = await syncConnection(row, organizationIds);
    summary.createdActivities += synced.createdActivities;
    if (synced.more) summary.more = true;
    if (synced.skipped) summary.skipped += 1;
    else if (!synced.error) summary.synced += 1;
    if (synced.error) summary.errors.push(synced.error);
    if (synced.error && /quota|per-minute limit/i.test(synced.error)) break;
  }

  if (summary.createdActivities > 0) {
    revalidatePath("/prospecting");
    revalidatePath("/prospecting/pending-emails");
    revalidatePath("/bookings");
    revalidatePath("/organizations");
  }
  return summary;
}
