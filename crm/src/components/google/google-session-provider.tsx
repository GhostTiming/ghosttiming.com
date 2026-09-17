"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { GoogleConnectionRow } from "@/lib/crm/google-sync";
import type { EmailMatchTargets } from "@/lib/google/email-match";
import {
  buildGmailAddressQuery,
  chunk,
  emailsForGmailSearch,
  matchEmailsToCrm,
  uniqueNormalizedEmails,
} from "@/lib/google/email-match";
import {
  getGmailMessage,
  getGmailProfile,
  listGmailHistoryMessageIds,
  listGmailMessageIds,
} from "@/lib/google/gmail-api";
import { parseGmailMessage } from "@/lib/google/gmail-parse";
import {
  createGoogleCalendarEvent,
  listGoogleCalendars,
  updateGoogleCalendarEvent,
  type GoogleCalendarEventWrite,
  type GoogleCalendarListEntry,
} from "@/lib/google/calendar-api";
import { googleMeetHangoutLink } from "@/lib/google/calendar-meeting";
import {
  GoogleAuthError,
  GoogleQuotaError,
  getGoogleUserInfo,
  setGoogleQuotaWaitHandler,
} from "@/lib/google/google-fetch";
import { clearStoredGoogleToken, pickPreferredGoogleConnection, restorableGoogleConnections, storedTokenFromResponse, writeStoredGoogleToken } from "@/lib/google/token-store";
import { hasGmailSendScope } from "@/lib/google/gmail-scopes";
import {
  GMAIL_INGEST_BATCH_SIZE,
  GMAIL_SEARCH_BATCH_SIZE,
} from "@/lib/google/scopes";

export type GoogleProgress = {
  label: string;
  current?: number;
  total?: number;
};

export type GmailSyncAttach = {
  prospectIds?: string[];
  bookingIds?: string[];
  organizationIds?: string[];
  personIds?: string[];
};

type GoogleSessionValue = {
  clientId: string;
  connection: GoogleConnectionRow | null;
  sendConnection: GoogleConnectionRow | null;
  calendarConnection: GoogleConnectionRow | null;
  connections: GoogleConnectionRow[];
  accessToken: string | null;
  expired: boolean;
  restoring: boolean;
  progress: GoogleProgress | null;
  error: string | null;
  calendars: GoogleCalendarListEntry[];
  pendingCalendarCount: number;
  hasGmailSend: boolean;
  connect: (options?: { addAccount?: boolean }) => Promise<void>;
  disconnect: (googleSub?: string) => Promise<void>;
  ensureGmailSendAccess: () => Promise<{ token: string; email: string; googleSub: string }>;
  backfillGmail: () => Promise<void>;
  syncGmail: () => Promise<void>;
  syncGmailForEmails: (emails: string[], attach?: GmailSyncAttach) => Promise<void>;
  syncCalendar: () => Promise<void>;
  selectCalendar: (calendarId: string, summary: string) => Promise<void>;
  createBookingEvent: (bookingId: string) => Promise<void>;
  updateBookingEvent: (bookingId: string) => Promise<void>;
  unlinkBookingEvent: (bookingId: string) => Promise<void>;
  createOutreachCalendarEvent: (event: GoogleCalendarEventWrite) => Promise<{
    id: string;
    calendarId: string;
    htmlLink?: string;
    hangoutLink?: string | null;
  }>;
  refreshPendingCalendarCount: () => Promise<void>;
};

const GoogleSessionContext = createContext<GoogleSessionValue | null>(null);

type GoogleOAuthSessionPayload = {
  accessToken: string;
  expiresAt: number;
  googleSub: string;
  googleEmail: string;
  scope: string | null;
  error?: string;
  needsReauth?: boolean;
};

class GoogleReauthNeededError extends Error {
  needsReauth = true as const;
}

async function fetchGoogleOAuthSession(googleSub?: string | null) {
  const url = googleSub
    ? `/api/google/oauth/session?googleSub=${encodeURIComponent(googleSub)}`
    : "/api/google/oauth/session";
  const response = await fetch(url, { credentials: "same-origin" });
  const payload = (await response.json().catch(() => null)) as GoogleOAuthSessionPayload | null;
  if (response.status === 409 || payload?.needsReauth) {
    throw new GoogleReauthNeededError(
      payload?.error || "Connect Google once more so the CRM can stay signed in.",
    );
  }
  if (!response.ok || !payload?.accessToken) {
    throw new Error(payload?.error || "Google session is not available.");
  }
  return payload;
}

function startGoogleOAuth(options?: { addAccount?: boolean; loginHint?: string | null }) {
  const params = new URLSearchParams({
    returnTo: `${window.location.pathname}${window.location.search}`,
  });
  if (options?.addAccount) params.set("addAccount", "1");
  else if (options?.loginHint) params.set("loginHint", options.loginHint);
  // Full navigation is required so the OAuth start route can set the state cookie
  // and 302 to Google. App Router client routing would not complete that handshake.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- OAuth start must be a full document navigation.
  window.location.assign(`/api/google/oauth/start?${params}`);
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  let payload: (T & { error?: string }) | null = null;
  if (text) {
    try {
      payload = JSON.parse(text) as T & { error?: string };
    } catch {
      payload = null;
    }
  }
  if (!response.ok) {
    throw new Error(
      payload?.error ||
        `Google Calendar request failed (${response.status}). Refresh the page and try again.`,
    );
  }
  if (!payload) {
    throw new Error("Google Calendar returned an empty response. Refresh the page and try again.");
  }
  return payload;
}

function catchupAfterQuery(lastSyncedAt: string | null) {
  if (!lastSyncedAt) return "";
  const date = new Date(lastSyncedAt);
  if (Number.isNaN(date.valueOf())) return "";
  date.setUTCDate(date.getUTCDate() - 1);
  const stamp = date.toISOString().slice(0, 10).replaceAll("-", "/");
  return ` after:${stamp}`;
}

export function GoogleSessionProvider({
  clientId,
  userId,
  initialConnections,
  initialSendGoogleSub = null,
  initialCalendarGoogleSub = null,
  children,
}: {
  clientId: string;
  userId: string;
  initialConnections: GoogleConnectionRow[];
  initialSendGoogleSub?: string | null;
  initialCalendarGoogleSub?: string | null;
  children: ReactNode;
}) {
  const [connections, setConnections] = useState<GoogleConnectionRow[]>(initialConnections);
  const sendGoogleSub = initialSendGoogleSub;
  const calendarGoogleSub = initialCalendarGoogleSub;
  const sendConnection =
    pickPreferredGoogleConnection(connections, sendGoogleSub) ??
    pickPreferredGoogleConnection(connections, calendarGoogleSub);
  const calendarConnection =
    pickPreferredGoogleConnection(connections, calendarGoogleSub) ?? sendConnection;
  const connection = sendConnection ?? calendarConnection;
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [restoring, setRestoring] = useState(
    () => Boolean(clientId) && restorableGoogleConnections(initialConnections).length > 0,
  );
  const [progress, setProgress] = useState<GoogleProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [calendars, setCalendars] = useState<GoogleCalendarListEntry[]>([]);
  const [pendingCalendarCount, setPendingCalendarCount] = useState(0);
  const [tokenScope, setTokenScope] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const tokenScopeRef = useRef<string | null>(null);
  const sendGoogleSubRef = useRef(sendGoogleSub);
  const calendarGoogleSubRef = useRef(calendarGoogleSub);
  const hydratedCalendarSub = useRef<string | null>(null);
  const restoreAttempted = useRef(false);

  const rememberToken = useCallback(
    (googleSub: string, tokenResponse: { access_token?: string; expires_in?: number; scope?: string }) => {
      const token = tokenResponse.access_token;
      if (!token) return;
      const scope = tokenResponse.scope ?? tokenScopeRef.current ?? undefined;
      tokenScopeRef.current = scope ?? null;
      setTokenScope(scope ?? null);
      writeStoredGoogleToken(
        userId,
        storedTokenFromResponse(googleSub, token, tokenResponse.expires_in, scope),
      );
    },
    [userId],
  );

  const hydrateToken = useCallback(
    async (token: string, googleSub: string, options?: { hydrateCalendars?: boolean }) => {
      await getGoogleUserInfo(token);
      tokenRef.current = token;
      setAccessToken(token);
      setExpired(false);
      if (options?.hydrateCalendars !== false) {
        try {
          const calendarList = await listGoogleCalendars(token);
          setCalendars(calendarList);
        } catch {
          setCalendars([]);
        }
      }
      try {
        const pending = await readJson<{ items: unknown[] }>(
          await fetch("/api/google/calendar?pending=1"),
        );
        setPendingCalendarCount(pending.items.length);
      } catch {
        setPendingCalendarCount(0);
      }
    },
    [],
  );

  const applyServerSession = useCallback(
    async (session: GoogleOAuthSessionPayload, options?: { hydrateCalendars?: boolean }) => {
      const expiresIn = Math.max(60, Math.floor((session.expiresAt - Date.now()) / 1000));
      rememberToken(session.googleSub, {
        access_token: session.accessToken,
        expires_in: expiresIn,
        scope: session.scope ?? undefined,
      });
      tokenRef.current = session.accessToken;
      setAccessToken(session.accessToken);
      setExpired(false);
      const hydrateCalendars =
        options?.hydrateCalendars ?? session.googleSub === calendarGoogleSubRef.current;
      if (hydrateCalendars) hydratedCalendarSub.current = session.googleSub;
      await hydrateToken(session.accessToken, session.googleSub, { hydrateCalendars });
      return session;
    },
    [hydrateToken, rememberToken],
  );

  const requestSilentToken = useCallback(async (googleSub?: string | null) => {
    try {
      return await applyServerSession(
        await fetchGoogleOAuthSession(googleSub ?? calendarGoogleSubRef.current ?? sendGoogleSubRef.current),
      );
    } catch {
      return null;
    }
  }, [applyServerSession]);

  const persistConnection = useCallback(async (patch: Record<string, unknown>) => {
    await readJson(await fetch("/api/google/connection", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }));
    const latest = await readJson<{
      connections?: GoogleConnectionRow[];
      connection: GoogleConnectionRow | null;
    }>(await fetch("/api/google/connection"));
    const rows = latest.connections ?? (latest.connection ? [latest.connection] : []);
    setConnections(rows);
    return (
      rows.find((item) => item.google_sub === patch.googleSub) ??
      pickPreferredGoogleConnection(rows, calendarGoogleSubRef.current) ??
      rows[0] ??
      null
    );
  }, []);

  const requireToken = useCallback(async (googleSub?: string | null) => {
    const session = await fetchGoogleOAuthSession(
      googleSub ?? calendarGoogleSubRef.current ?? sendGoogleSubRef.current,
    );
    await applyServerSession(session);
    return session.accessToken;
  }, [applyServerSession]);

  const markExpired = useCallback(async (message: string) => {
    tokenRef.current = null;
    setAccessToken(null);
    setExpired(true);
    setError(message);
    clearStoredGoogleToken(userId);
    const current = connection;
    if (current) {
      await persistConnection({
        googleSub: current.google_sub,
        googleEmail: current.google_email,
        gmailStatus: "expired",
        calendarStatus: "expired",
        gmailLastError: message,
        calendarLastError: message,
      });
    }
  }, [connection, persistConnection, userId]);

  const withGoogle = useCallback(
    async <T,>(work: (token: string) => Promise<T>, googleSub?: string | null) => {
      setGoogleQuotaWaitHandler(({ delayMs, attempt }) => {
        setProgress({
          label: `Gmail paused for quota (retry ${attempt} in ${Math.ceil(delayMs / 1000)}s)`,
        });
      });
      const expireMessage = (status: number) =>
        status === 403
          ? "Google permissions are missing or were revoked."
          : "Google authorization expired. Reconnect to continue.";
      const targetSub = googleSub ?? calendarGoogleSubRef.current ?? sendGoogleSubRef.current;
      try {
        return await work(await requireToken(targetSub));
      } catch (caught) {
        if (caught instanceof GoogleQuotaError) {
          throw caught;
        }
        if (caught instanceof GoogleAuthError && caught.status === 401) {
          const refreshed = await requestSilentToken(targetSub);
          if (refreshed?.accessToken) {
            try {
              return await work(refreshed.accessToken);
            } catch (retryCaught) {
              if (
                retryCaught instanceof GoogleAuthError &&
                (retryCaught.status === 401 || retryCaught.status === 403)
              ) {
                await markExpired(expireMessage(retryCaught.status));
              }
              throw retryCaught;
            }
          }
          await markExpired(expireMessage(401));
          throw caught;
        }
        if (caught instanceof GoogleAuthError && caught.status === 403) {
          await markExpired(expireMessage(403));
        }
        throw caught;
      } finally {
        setGoogleQuotaWaitHandler(null);
      }
    },
    [markExpired, requestSilentToken, requireToken],
  );

  const ingestMessages = useCallback(
    async (
      token: string,
      googleSub: string,
      googleEmail: string,
      ids: string[],
      index: Record<string, EmailMatchTargets>,
    ) => {
      const uniqueIds = [...new Set(ids)];
      let processed = 0;
      for (const idBatch of chunk(uniqueIds, 100)) {
        const known = await readJson<{ ids: string[] }>(
          await fetch("/api/google/gmail/known-ids", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ googleSub, ids: idBatch }),
          }),
        );
        const knownSet = new Set(known.ids);
        const freshIds = idBatch.filter((id) => !knownSet.has(id));
        for (const messageBatch of chunk(freshIds, GMAIL_INGEST_BATCH_SIZE)) {
          const parsed = [];
          for (const id of messageBatch) {
            const raw = await getGmailMessage(token, id);
            const message = parseGmailMessage(raw, googleEmail);
            if (!message) continue;
            const matches = matchEmailsToCrm(message.involvedEmails, index);
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
          if (parsed.length) {
            await readJson(
              await fetch("/api/google/gmail/ingest", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  googleSub,
                  googleEmail,
                  messages: parsed,
                }),
              }),
            );
          }
          processed += messageBatch.length;
          setProgress({
            label: `Processing ${processed} / ${uniqueIds.length} messages`,
            current: processed,
            total: uniqueIds.length,
          });
        }
      }
    },
    [],
  );

  const loadMatchIndex = useCallback(async () => {
    const result = await readJson<{ index: Record<string, EmailMatchTargets> }>(
      await fetch("/api/google/gmail/match-index"),
    );
    return result.index;
  }, []);

  const runTargetedGmailSearch = useCallback(
    async (
      token: string,
      extraQuery = "",
      options?: {
        emails?: string[];
        attach?: GmailSyncAttach;
        googleSub?: string;
        googleEmail?: string;
      },
    ) => {
      setProgress({ label: "Searching Gmail..." });
      const index = await loadMatchIndex();
      const emails = options?.emails?.length
        ? uniqueNormalizedEmails(options.emails)
        : emailsForGmailSearch(index);
      if (options?.attach) {
        for (const email of emails) {
          const existing = index[email] ?? {
            prospectIds: [],
            bookingIds: [],
            organizationIds: [],
            personIds: [],
          };
          index[email] = {
            prospectIds: [...new Set([...existing.prospectIds, ...(options.attach.prospectIds ?? [])])],
            bookingIds: [...new Set([...existing.bookingIds, ...(options.attach.bookingIds ?? [])])],
            organizationIds: [
              ...new Set([...existing.organizationIds, ...(options.attach.organizationIds ?? [])]),
            ],
            personIds: [...new Set([...existing.personIds, ...(options.attach.personIds ?? [])])],
          };
        }
      }
      if (!emails.length) {
        const profile = await getGmailProfile(token);
        return profile;
      }
      const ids: string[] = [];
      let batchNumber = 0;
      const batches = chunk(emails, GMAIL_SEARCH_BATCH_SIZE);
      for (const addresses of batches) {
        batchNumber += 1;
        setProgress({
          label: `Searching Gmail... ${batchNumber} / ${batches.length}`,
          current: batchNumber,
          total: batches.length,
        });
        const found = await listGmailMessageIds(
          token,
          `${buildGmailAddressQuery(addresses)}${extraQuery}`,
        );
        ids.push(...found);
      }
      const profile = await getGmailProfile(token);
      const googleSub = options?.googleSub ?? (await getGoogleUserInfo(token)).sub;
      await ingestMessages(token, googleSub, profile.emailAddress, ids, index);
      return profile;
    },
    [ingestMessages, loadMatchIndex],
  );

  const connect = useCallback((options?: { addAccount?: boolean }) => {
    if (!clientId) {
      return Promise.reject(new Error("NEXT_PUBLIC_GOOGLE_CLIENT_ID is not configured."));
    }
    setError(null);
    startGoogleOAuth({
      addAccount: options?.addAccount,
      loginHint: options?.addAccount ? null : connection?.google_email,
    });
    return Promise.resolve();
  }, [clientId, connection?.google_email]);

  const disconnect = useCallback(async (googleSub?: string) => {
    tokenRef.current = null;
    tokenScopeRef.current = null;
    setAccessToken(null);
    setTokenScope(null);
    setExpired(false);
    clearStoredGoogleToken(userId);
    await persistConnection({
      googleSub: googleSub ?? connection?.google_sub,
      disconnect: true,
    });
  }, [connection, persistConnection, userId]);

  const ensureGmailSendAccess = useCallback(async () => {
    if (!clientId) {
      throw new Error("NEXT_PUBLIC_GOOGLE_CLIENT_ID is not configured.");
    }
    const account = sendConnection ?? connection;
    if (!account) {
      startGoogleOAuth();
      throw new Error("Connect Google before sending email.");
    }
    if (hasGmailSendScope(tokenScopeRef.current) && tokenRef.current && account.google_sub === sendGoogleSubRef.current) {
      return {
        token: tokenRef.current,
        email: account.google_email,
        googleSub: account.google_sub,
      };
    }
    try {
      const session = await applyServerSession(
        await fetchGoogleOAuthSession(account.google_sub),
        { hydrateCalendars: false },
      );
      if (!hasGmailSendScope(session.scope)) {
        startGoogleOAuth({ loginHint: session.googleEmail });
        throw new Error("Redirecting to Google to grant Gmail send.");
      }
      return {
        token: session.accessToken,
        email: session.googleEmail,
        googleSub: session.googleSub,
      };
    } catch (error) {
      if (error instanceof GoogleReauthNeededError) {
        startGoogleOAuth({ loginHint: account.google_email });
      }
      throw error;
    }
  }, [applyServerSession, clientId, connection, sendConnection]);

  useEffect(() => {
    sendGoogleSubRef.current = sendGoogleSub;
    calendarGoogleSubRef.current = calendarGoogleSub;
  }, [calendarGoogleSub, sendGoogleSub]);

  useEffect(() => {
    if (restoreAttempted.current) return;
    restoreAttempted.current = true;
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const oauthError =
        params.get("google_oauth") === "error"
          ? params.get("google_oauth_error") || "Google sign-in failed."
          : null;
      if (oauthError) setError(oauthError);
      if (params.has("google_oauth")) {
        params.delete("google_oauth");
        params.delete("google_oauth_error");
        const clean = `${window.location.pathname}${params.size ? `?${params}` : ""}${window.location.hash}`;
        window.history.replaceState(null, "", clean);
      }
      const restorable = restorableGoogleConnections(initialConnections);
      const preferred =
        pickPreferredGoogleConnection(restorable, initialCalendarGoogleSub) ??
        pickPreferredGoogleConnection(restorable, initialSendGoogleSub) ??
        restorable.find((row) => row.has_offline_grant) ??
        restorable[0];
      if (!preferred) {
        if (
          !oauthError &&
          initialConnections.some((row) =>
            row.gmail_status !== "disconnected" || row.calendar_status !== "disconnected"
          )
        ) {
          setExpired(true);
          setError("Connect Google once more so the CRM can stay signed in.");
        }
        setRestoring(false);
        return;
      }
      try {
        await applyServerSession(await fetchGoogleOAuthSession(preferred.google_sub), {
          hydrateCalendars: true,
        });
        const sendPreferred = pickPreferredGoogleConnection(restorable, initialSendGoogleSub);
        if (sendPreferred && sendPreferred.google_sub !== preferred.google_sub) {
          await applyServerSession(await fetchGoogleOAuthSession(sendPreferred.google_sub), {
            hydrateCalendars: false,
          });
        }
      } catch (error) {
        if (error instanceof GoogleReauthNeededError) {
          setExpired(true);
          setError(error.message);
        }
      } finally {
        setRestoring(false);
      }
    })();
  }, [applyServerSession, initialCalendarGoogleSub, initialConnections, initialSendGoogleSub]);

  useEffect(() => {
    if (restoring || !calendarGoogleSub) return;
    if (hydratedCalendarSub.current === calendarGoogleSub) return;
    void (async () => {
      try {
        await applyServerSession(await fetchGoogleOAuthSession(calendarGoogleSub), {
          hydrateCalendars: true,
        });
      } catch {
        // Settings/reconnect copy already explains a missing Google grant.
      }
    })();
  }, [applyServerSession, calendarGoogleSub, restoring]);

  const backfillGmail = useCallback(async () => {
    setError(null);
    const accounts = restorableGoogleConnections(connections);
    if (!accounts.length) throw new Error("Connect Google before backfilling Gmail.");
    try {
      for (const current of accounts) {
        await persistConnection({
          googleSub: current.google_sub,
          googleEmail: current.google_email,
          gmailStatus: "syncing",
          gmailLastError: null,
        });
        const profile = await withGoogle(
          (token) =>
            runTargetedGmailSearch(token, "", {
              googleSub: current.google_sub,
              googleEmail: current.google_email,
            }),
          current.google_sub,
        );
        await persistConnection({
          googleSub: current.google_sub,
          googleEmail: current.google_email,
          gmailStatus: "synced",
          gmailHistoryId: profile.historyId,
          gmailBackfillCompleted: true,
          markGmailSynced: true,
          gmailLastError: null,
        });
      }
    } catch (caught) {
      const message =
        caught instanceof GoogleQuotaError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : "Gmail backfill failed.";
      setError(message);
      throw caught;
    } finally {
      setProgress(null);
    }
  }, [connections, persistConnection, runTargetedGmailSearch, withGoogle]);

  const syncGmail = useCallback(async () => {
    setError(null);
    const accounts = restorableGoogleConnections(connections);
    if (!accounts.length) throw new Error("Connect Google before syncing Gmail.");
    try {
      for (const current of accounts) {
        await persistConnection({
          googleSub: current.google_sub,
          googleEmail: current.google_email,
          gmailStatus: "syncing",
          gmailLastError: null,
        });
        const profile = await withGoogle(async (token) => {
          if (current.gmail_history_id) {
            try {
              setProgress({ label: `Checking Gmail changes for ${current.google_email}...` });
              const history = await listGmailHistoryMessageIds(token, current.gmail_history_id!);
              const index = await loadMatchIndex();
              await ingestMessages(
                token,
                current.google_sub,
                current.google_email,
                history.ids,
                index,
              );
              return { historyId: history.historyId };
            } catch (caught) {
              if (!(caught instanceof GoogleAuthError) || caught.status !== 404) throw caught;
              return runTargetedGmailSearch(
                token,
                catchupAfterQuery(current.gmail_last_synced_at),
                { googleSub: current.google_sub, googleEmail: current.google_email },
              );
            }
          }
          return runTargetedGmailSearch(
            token,
            catchupAfterQuery(current.gmail_last_synced_at),
            { googleSub: current.google_sub, googleEmail: current.google_email },
          );
        }, current.google_sub);
        await persistConnection({
          googleSub: current.google_sub,
          googleEmail: current.google_email,
          gmailStatus: "synced",
          gmailHistoryId: profile.historyId,
          markGmailSynced: true,
          gmailLastError: null,
        });
      }
    } catch (caught) {
      const message =
        caught instanceof GoogleQuotaError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : "Gmail sync failed.";
      setError(message);
      throw caught;
    } finally {
      setProgress(null);
    }
  }, [connections, ingestMessages, loadMatchIndex, persistConnection, runTargetedGmailSearch, withGoogle]);

  const syncGmailForEmails = useCallback(
    async (emails: string[], attach?: GmailSyncAttach) => {
      setError(null);
      const accounts = restorableGoogleConnections(connections);
      if (!accounts.length) throw new Error("Connect Google before syncing Gmail.");
      const targets = uniqueNormalizedEmails(emails);
      if (!targets.length) throw new Error("No email address to sync.");
      try {
        for (const current of accounts) {
          await withGoogle(
            (token) =>
              runTargetedGmailSearch(token, "", {
                emails: targets,
                attach,
                googleSub: current.google_sub,
                googleEmail: current.google_email,
              }),
            current.google_sub,
          );
        }
      } catch (caught) {
        const message =
          caught instanceof GoogleQuotaError
            ? caught.message
            : caught instanceof Error
              ? caught.message
              : "Gmail re-sync failed.";
        setError(message);
        throw caught;
      } finally {
        setProgress(null);
      }
    },
    [connections, runTargetedGmailSearch, withGoogle],
  );

  const persistCalendarResult = useCallback(
    async (input: {
      bookingId: string;
      googleCalendarId: string;
      googleEventId: string;
      htmlLink?: string | null;
      syncStatus: "synced" | "needs_sync" | "error" | "deleted";
      lastError?: string | null;
      unlink?: boolean;
    }) => {
      if (!calendarConnection) throw new Error("Connect Google first.");
      await readJson(
        await fetch("/api/google/calendar", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...input,
            googleSub: calendarConnection.google_sub,
            googleEmail: calendarConnection.google_email,
          }),
        }),
      );
    },
    [calendarConnection],
  );

  const refreshPendingCalendarCount = useCallback(async () => {
    const result = await readJson<{ items: unknown[] }>(
      await fetch("/api/google/calendar?pending=1"),
    );
    setPendingCalendarCount(result.items.length);
  }, []);

  const syncCalendar = useCallback(async () => {
    if (!calendarConnection) throw new Error("Connect Google before syncing Calendar.");
    setError(null);
    setProgress({ label: "Syncing Google Calendar..." });
    try {
      await withGoogle(async (token) => {
        const pending = await readJson<{
          items: Array<{
            bookingId: string;
            calendarId: string | null;
            eventId: string | null;
            status: string;
            event: Parameters<typeof updateGoogleCalendarEvent>[3] | null;
          }>;
        }>(await fetch("/api/google/calendar?pending=1"));
        setPendingCalendarCount(pending.items.length);
        let current = 0;
        for (const item of pending.items) {
          current += 1;
          setProgress({
            label: `${pending.items.length} calendar events need syncing`,
            current,
            total: pending.items.length,
          });
          if (!item.event || !item.calendarId || !item.eventId) {
            await persistCalendarResult({
              bookingId: item.bookingId,
              googleCalendarId: item.calendarId ?? calendarConnection.calendar_id ?? "primary",
              googleEventId: item.eventId ?? "missing",
              syncStatus: "error",
              lastError: "This booking is missing times needed for Google Calendar.",
            });
            continue;
          }
          try {
            const updated = await updateGoogleCalendarEvent(
              token,
              item.calendarId,
              item.eventId,
              item.event,
            );
            await persistCalendarResult({
              bookingId: item.bookingId,
              googleCalendarId: item.calendarId,
              googleEventId: updated.id ?? item.eventId,
              htmlLink: updated.htmlLink,
              syncStatus: "synced",
              lastError: null,
            });
          } catch (caught) {
            if (caught instanceof GoogleAuthError && caught.status === 404) {
              await persistCalendarResult({
                bookingId: item.bookingId,
                googleCalendarId: item.calendarId,
                googleEventId: item.eventId,
                syncStatus: "deleted",
                lastError: "The Google Calendar event was deleted.",
              });
              continue;
            }
            throw caught;
          }
        }
        await persistConnection({
          googleSub: calendarConnection.google_sub,
          googleEmail: calendarConnection.google_email,
          calendarStatus: "synced",
          markCalendarSynced: true,
          calendarLastError: null,
        });
      }, calendarConnection.google_sub);
      await refreshPendingCalendarCount();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Calendar sync failed.";
      await persistConnection({
        googleSub: calendarConnection.google_sub,
        googleEmail: calendarConnection.google_email,
        calendarStatus: "error",
        calendarLastError: message,
      });
      setError(message);
      throw caught;
    } finally {
      setProgress(null);
    }
  }, [calendarConnection, persistCalendarResult, persistConnection, refreshPendingCalendarCount, withGoogle]);

  const selectCalendar = useCallback(
    async (calendarId: string, summary: string) => {
      if (!calendarConnection) return;
      await persistConnection({
        googleSub: calendarConnection.google_sub,
        googleEmail: calendarConnection.google_email,
        calendarId,
        calendarSummary: summary,
        calendarStatus: "connected",
      });
    },
    [calendarConnection, persistConnection],
  );

  const createBookingEvent = useCallback(
    async (bookingId: string) => {
      if (!calendarConnection) throw new Error("Connect Google first.");
      await withGoogle(async (token) => {
        const payload = await readJson<{
          calendarId: string | null;
          eventId: string | null;
          event: Parameters<typeof createGoogleCalendarEvent>[2] | null;
        }>(await fetch(`/api/google/calendar?bookingId=${bookingId}`));
        if (payload.eventId) return;
        if (!payload.event) {
          throw new Error("Add arrival and departure times before creating a Calendar event.");
        }
        const calendarId = payload.calendarId || calendarConnection.calendar_id || "primary";
        const created = await createGoogleCalendarEvent(token, calendarId, payload.event);
        if (!created.id) throw new Error("Google Calendar did not return an event ID.");
        await persistCalendarResult({
          bookingId,
          googleCalendarId: calendarId,
          googleEventId: created.id,
          htmlLink: created.htmlLink,
          syncStatus: "synced",
          lastError: null,
        });
      }, calendarConnection.google_sub);
    },
    [calendarConnection, persistCalendarResult, withGoogle],
  );

  const updateBookingEvent = useCallback(
    async (bookingId: string) => {
      if (!calendarConnection) throw new Error("Connect Google first.");
      await withGoogle(async (token) => {
        const payload = await readJson<{
          calendarId: string | null;
          eventId: string | null;
          event: Parameters<typeof updateGoogleCalendarEvent>[3] | null;
        }>(await fetch(`/api/google/calendar?bookingId=${bookingId}`));
        if (!payload.eventId || !payload.calendarId) {
          throw new Error("This booking is not linked to a Google Calendar event.");
        }
        if (!payload.event) {
          throw new Error("This booking is missing times needed for Google Calendar.");
        }
        try {
          const updated = await updateGoogleCalendarEvent(
            token,
            payload.calendarId,
            payload.eventId,
            payload.event,
          );
          await persistCalendarResult({
            bookingId,
            googleCalendarId: payload.calendarId,
            googleEventId: updated.id ?? payload.eventId,
            htmlLink: updated.htmlLink,
            syncStatus: "synced",
            lastError: null,
          });
        } catch (caught) {
          if (caught instanceof GoogleAuthError && caught.status === 404) {
            await persistCalendarResult({
              bookingId,
              googleCalendarId: payload.calendarId,
              googleEventId: payload.eventId,
              syncStatus: "deleted",
              lastError: "The Google Calendar event was deleted.",
            });
            return;
          }
          const message = caught instanceof Error ? caught.message : "Calendar update failed.";
          await persistCalendarResult({
            bookingId,
            googleCalendarId: payload.calendarId,
            googleEventId: payload.eventId,
            syncStatus: "error",
            lastError: message,
          });
          throw caught;
        }
      }, calendarConnection.google_sub);
    },
    [calendarConnection, persistCalendarResult, withGoogle],
  );

  const unlinkBookingEvent = useCallback(
    async (bookingId: string) => {
      if (!calendarConnection) return;
      const payload = await readJson<{
        eventId: string | null;
        calendarId: string | null;
      }>(await fetch(`/api/google/calendar?bookingId=${bookingId}`));
      await persistCalendarResult({
        bookingId,
        googleCalendarId: payload.calendarId ?? calendarConnection.calendar_id ?? "primary",
        googleEventId: payload.eventId ?? "unlinked",
        syncStatus: "synced",
        unlink: true,
      });
    },
    [calendarConnection, persistCalendarResult],
  );

  const createOutreachCalendarEvent = useCallback(
    async (event: GoogleCalendarEventWrite) => {
      if (!calendarConnection) throw new Error("Connect Google first.");
      return withGoogle(async (token) => {
        const calendarId = calendarConnection.calendar_id || "primary";
        const created = await createGoogleCalendarEvent(token, calendarId, event);
        if (!created.id) throw new Error("Google Calendar did not return an event ID.");
        return {
          id: created.id,
          calendarId,
          htmlLink: created.htmlLink,
          hangoutLink: googleMeetHangoutLink(created),
        };
      }, calendarConnection.google_sub);
    },
    [calendarConnection, withGoogle],
  );

  const value = useMemo<GoogleSessionValue>(
    () => ({
      clientId,
      connection,
      sendConnection,
      calendarConnection,
      connections,
      accessToken,
      expired: !accessToken && (expired || connection?.gmail_status === "expired"),
      restoring,
      progress,
      error,
      calendars,
      pendingCalendarCount,
      hasGmailSend: hasGmailSendScope(tokenScope),
      connect,
      disconnect,
      ensureGmailSendAccess,
      backfillGmail,
      syncGmail,
      syncGmailForEmails,
      syncCalendar,
      selectCalendar,
      createBookingEvent,
      updateBookingEvent,
      unlinkBookingEvent,
      createOutreachCalendarEvent,
      refreshPendingCalendarCount,
    }),
    [
      accessToken,
      backfillGmail,
      calendarConnection,
      calendars,
      clientId,
      connect,
      connection,
      connections,
      createBookingEvent,
      createOutreachCalendarEvent,
      disconnect,
      ensureGmailSendAccess,
      error,
      expired,
      pendingCalendarCount,
      restoring,
      progress,
      refreshPendingCalendarCount,
      selectCalendar,
      sendConnection,
      syncCalendar,
      syncGmail,
      syncGmailForEmails,
      tokenScope,
      unlinkBookingEvent,
      updateBookingEvent,
    ],
  );

  return (
    <GoogleSessionContext.Provider value={value}>
      {children}
    </GoogleSessionContext.Provider>
  );
}

export function useGoogleSession() {
  const value = useContext(GoogleSessionContext);
  if (!value) throw new Error("useGoogleSession must be used within GoogleSessionProvider.");
  return value;
}

export function useOptionalGoogleSession() {
  return useContext(GoogleSessionContext);
}
