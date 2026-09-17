"use client";

import Script from "next/script";
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
import { requestGoogleAccessToken, revokeGoogleAccessToken, waitForGis, type GoogleTokenResponse } from "@/lib/google/gis";
import {
  canHydrateStoredGoogleToken,
  clearStoredGoogleToken,
  readStoredGoogleToken,
  restorableGoogleConnections,
  shouldClearStoredGoogleTokenOnRestore,
  storedTokenFromResponse,
  writeStoredGoogleToken,
} from "@/lib/google/token-store";
import { hasGmailSendScope } from "@/lib/google/gmail-scopes";
import {
  CALENDAR_EVENTS_SCOPE,
  GMAIL_INGEST_BATCH_SIZE,
  GMAIL_SCOPE,
  GMAIL_SEARCH_BATCH_SIZE,
  GOOGLE_SCOPE_STRING,
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
  children,
}: {
  clientId: string;
  userId: string;
  initialConnections: GoogleConnectionRow[];
  children: ReactNode;
}) {
  const [connections, setConnections] = useState<GoogleConnectionRow[]>(initialConnections);
  const [activeGoogleSub, setActiveGoogleSub] = useState<string | null>(
    initialConnections[0]?.google_sub ?? null,
  );
  const connection =
    connections.find((item) => item.google_sub === activeGoogleSub) ?? connections[0] ?? null;
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
  const restoreAttempted = useRef(false);

  const rememberToken = useCallback(
    (googleSub: string, tokenResponse: Pick<GoogleTokenResponse, "access_token" | "expires_in" | "scope">) => {
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
    async (token: string, googleSub: string) => {
      await getGoogleUserInfo(token);
      tokenRef.current = token;
      setAccessToken(token);
      setExpired(false);
      setActiveGoogleSub(googleSub);
      try {
        const calendarList = await listGoogleCalendars(token);
        setCalendars(calendarList);
      } catch {
        setCalendars([]);
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

  const requestSilentToken = useCallback(async (loginHint?: string | null) => {
    if (!clientId) return null;
    await waitForGis();
    const tokenResponse = await requestGoogleAccessToken({
      clientId,
      scope: GOOGLE_SCOPE_STRING,
      prompt: "",
      loginHint: loginHint ?? undefined,
    });
    const token = tokenResponse.access_token;
    if (!token) return null;
    const userInfo = await getGoogleUserInfo(token);
    rememberToken(userInfo.sub, tokenResponse);
    await hydrateToken(token, userInfo.sub);
    return tokenResponse;
  }, [clientId, hydrateToken, rememberToken]);

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
    const nextSub =
      typeof patch.googleSub === "string"
        ? patch.googleSub
        : activeGoogleSub;
    const selected =
      rows.find((item) => item.google_sub === nextSub) ?? rows[0] ?? null;
    setActiveGoogleSub(selected?.google_sub ?? null);
    return selected;
  }, [activeGoogleSub]);

  const requireToken = useCallback(async () => {
    if (tokenRef.current) return tokenRef.current;
    throw new Error("Google authorization is required.");
  }, []);

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
    async <T,>(work: (token: string) => Promise<T>) => {
      setGoogleQuotaWaitHandler(({ delayMs, attempt }) => {
        setProgress({
          label: `Gmail paused for quota (retry ${attempt} in ${Math.ceil(delayMs / 1000)}s)`,
        });
      });
      const expireMessage = (status: number) =>
        status === 403
          ? "Google permissions are missing or were revoked."
          : "Google authorization expired. Reconnect to continue.";
      try {
        return await work(await requireToken());
      } catch (caught) {
        if (caught instanceof GoogleQuotaError) {
          throw caught;
        }
        if (caught instanceof GoogleAuthError && caught.status === 401) {
          let refreshed: GoogleTokenResponse | null = null;
          try {
            refreshed = await requestSilentToken(connection?.google_email);
          } catch {
            refreshed = null;
          }
          if (refreshed?.access_token) {
            try {
              return await work(refreshed.access_token);
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
    [connection, markExpired, requestSilentToken, requireToken],
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
      options?: { emails?: string[]; attach?: GmailSyncAttach },
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
      const googleSub = connection?.google_sub ?? (await getGoogleUserInfo(token)).sub;
      await ingestMessages(token, googleSub, profile.emailAddress, ids, index);
      return profile;
    },
    [connection, ingestMessages, loadMatchIndex],
  );

  const connect = useCallback((options?: { addAccount?: boolean }) => {
    if (!clientId) {
      return Promise.reject(new Error("NEXT_PUBLIC_GOOGLE_CLIENT_ID is not configured."));
    }
    setError(null);
    let tokenPromise: Promise<GoogleTokenResponse>;
    try {
      tokenPromise = requestGoogleAccessToken({
        clientId,
        scope: GOOGLE_SCOPE_STRING,
        prompt: options?.addAccount || !connection ? "select_account" : "",
        loginHint: options?.addAccount ? undefined : connection?.google_email,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Google authorization failed.";
      setError(message);
      return Promise.reject(error);
    }
    return tokenPromise.then(async (tokenResponse) => {
      const token = tokenResponse.access_token;
      if (!token) throw new Error("Google did not return an access token.");
      const grantedGmail = tokenResponse.scope?.includes("gmail") ?? true;
      const grantedCalendar = tokenResponse.scope?.includes("calendar") ?? true;
      if (!grantedGmail && !grantedCalendar) {
        throw new Error("Gmail and Calendar permissions were not granted.");
      }
      const userInfo = await getGoogleUserInfo(token);
      rememberToken(userInfo.sub, tokenResponse);
      tokenRef.current = token;
      setAccessToken(token);
      setExpired(false);
      setActiveGoogleSub(userInfo.sub);
      const calendarList = grantedCalendar ? await listGoogleCalendars(token) : [];
      setCalendars(calendarList);
      const existing = connections.find((item) => item.google_sub === userInfo.sub);
      const selected =
        existing?.calendar_id && calendarList.some((item) => item.id === existing.calendar_id)
          ? calendarList.find((item) => item.id === existing.calendar_id)
          : calendarList.find((item) => item.primary) ?? calendarList[0];
      await persistConnection({
        googleSub: userInfo.sub,
        googleEmail: userInfo.email,
        gmailStatus: grantedGmail ? "connected" : "error",
        calendarStatus: grantedCalendar ? "connected" : "error",
        calendarId: selected?.id ?? null,
        calendarSummary: selected?.summary ?? null,
        gmailLastError: grantedGmail ? null : "Gmail permission was not granted.",
        calendarLastError: grantedCalendar ? null : "Calendar permission was not granted.",
      });
      try {
        const pending = await readJson<{ items: unknown[] }>(
          await fetch("/api/google/calendar?pending=1"),
        );
        setPendingCalendarCount(pending.items.length);
      } catch {
        setPendingCalendarCount(0);
      }
    }).catch((error) => {
      const message = error instanceof Error ? error.message : "Google authorization failed.";
      setError(message);
      throw error;
    });
  }, [clientId, connection, connections, persistConnection, rememberToken]);

  const disconnect = useCallback(async (googleSub?: string) => {
    if (tokenRef.current) revokeGoogleAccessToken(tokenRef.current);
    tokenRef.current = null;
    tokenScopeRef.current = null;
    setAccessToken(null);
    setTokenScope(null);
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
    if (hasGmailSendScope(tokenScopeRef.current) && tokenRef.current) {
      if (!connection?.google_email) throw new Error("Connect Google before sending.");
      return {
        token: tokenRef.current,
        email: connection.google_email,
        googleSub: connection.google_sub,
      };
    }
    await waitForGis();
    const tokenResponse = await requestGoogleAccessToken({
      clientId,
      scope: GOOGLE_SCOPE_STRING,
      prompt: "consent",
      loginHint: connection?.google_email,
    });
    const token = tokenResponse.access_token;
    if (!token) throw new Error("Google did not return an access token.");
    if (!hasGmailSendScope(tokenResponse.scope)) {
      throw new Error("Gmail send permission was not granted.");
    }
    const userInfo = await getGoogleUserInfo(token);
    rememberToken(userInfo.sub, tokenResponse);
    tokenRef.current = token;
    setAccessToken(token);
    setExpired(false);
    setActiveGoogleSub(userInfo.sub);
    return { token, email: userInfo.email, googleSub: userInfo.sub };
  }, [clientId, connection, rememberToken]);

  useEffect(() => {
    if (restoreAttempted.current) return;
    restoreAttempted.current = true;
    void (async () => {
      const stored = readStoredGoogleToken(userId);
      if (canHydrateStoredGoogleToken(stored, initialConnections) && stored) {
        try {
          tokenScopeRef.current = stored.scope ?? null;
          setTokenScope(stored.scope ?? null);
          await hydrateToken(stored.accessToken, stored.googleSub);
          setRestoring(false);
          return;
        } catch {
          // Access token was rejected; keep the identity and try silent GIS.
        }
      }

      if (shouldClearStoredGoogleTokenOnRestore(stored, initialConnections)) {
        clearStoredGoogleToken(userId);
      }
      setRestoring(false);
    })();
  }, [hydrateToken, initialConnections, userId]);

  const backfillGmail = useCallback(async () => {
    setError(null);
    const current = connection;
    if (!current) throw new Error("Connect Google before backfilling Gmail.");
    await persistConnection({
      googleSub: current.google_sub,
      googleEmail: current.google_email,
      gmailStatus: "syncing",
      gmailLastError: null,
    });
    try {
      const profile = await withGoogle((token) => runTargetedGmailSearch(token));
      await persistConnection({
        googleSub: current.google_sub,
        googleEmail: current.google_email,
        gmailStatus: "synced",
        gmailHistoryId: profile.historyId,
        gmailBackfillCompleted: true,
        markGmailSynced: true,
        gmailLastError: null,
      });
    } catch (caught) {
      const message =
        caught instanceof GoogleQuotaError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : "Gmail backfill failed.";
      await persistConnection({
        googleSub: current.google_sub,
        googleEmail: current.google_email,
        gmailStatus: "error",
        gmailLastError: message,
      });
      setError(message);
      throw caught;
    } finally {
      setProgress(null);
    }
  }, [connection, persistConnection, runTargetedGmailSearch, withGoogle]);

  const syncGmail = useCallback(async () => {
    setError(null);
    const current = connection;
    if (!current) throw new Error("Connect Google before syncing Gmail.");
    await persistConnection({
      googleSub: current.google_sub,
      googleEmail: current.google_email,
      gmailStatus: "syncing",
      gmailLastError: null,
    });
    try {
      const profile = await withGoogle(async (token) => {
        if (current.gmail_history_id) {
          try {
            setProgress({ label: "Checking Gmail changes..." });
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
            return runTargetedGmailSearch(token, catchupAfterQuery(current.gmail_last_synced_at));
          }
        }
        return runTargetedGmailSearch(token, catchupAfterQuery(current.gmail_last_synced_at));
      });
      await persistConnection({
        googleSub: current.google_sub,
        googleEmail: current.google_email,
        gmailStatus: "synced",
        gmailHistoryId: profile.historyId,
        markGmailSynced: true,
        gmailLastError: null,
      });
    } catch (caught) {
      const message =
        caught instanceof GoogleQuotaError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : "Gmail sync failed.";
      await persistConnection({
        googleSub: current.google_sub,
        googleEmail: current.google_email,
        gmailStatus: "error",
        gmailLastError: message,
      });
      setError(message);
      throw caught;
    } finally {
      setProgress(null);
    }
  }, [connection, ingestMessages, loadMatchIndex, persistConnection, runTargetedGmailSearch, withGoogle]);

  const syncGmailForEmails = useCallback(
    async (emails: string[], attach?: GmailSyncAttach) => {
      setError(null);
      const current = connection;
      if (!current) throw new Error("Connect Google before syncing Gmail.");
      const targets = uniqueNormalizedEmails(emails);
      if (!targets.length) throw new Error("No email address to sync.");
      try {
        await withGoogle((token) =>
          runTargetedGmailSearch(token, "", { emails: targets, attach }),
        );
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
    [connection, runTargetedGmailSearch, withGoogle],
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
      if (!connection) throw new Error("Connect Google first.");
      await readJson(
        await fetch("/api/google/calendar", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...input,
            googleSub: connection.google_sub,
            googleEmail: connection.google_email,
          }),
        }),
      );
    },
    [connection],
  );

  const refreshPendingCalendarCount = useCallback(async () => {
    const result = await readJson<{ items: unknown[] }>(
      await fetch("/api/google/calendar?pending=1"),
    );
    setPendingCalendarCount(result.items.length);
  }, []);

  const syncCalendar = useCallback(async () => {
    if (!connection) throw new Error("Connect Google before syncing Calendar.");
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
              googleCalendarId: item.calendarId ?? connection.calendar_id ?? "primary",
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
          googleSub: connection.google_sub,
          googleEmail: connection.google_email,
          calendarStatus: "synced",
          markCalendarSynced: true,
          calendarLastError: null,
        });
      });
      await refreshPendingCalendarCount();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Calendar sync failed.";
      await persistConnection({
        googleSub: connection.google_sub,
        googleEmail: connection.google_email,
        calendarStatus: "error",
        calendarLastError: message,
      });
      setError(message);
      throw caught;
    } finally {
      setProgress(null);
    }
  }, [connection, persistCalendarResult, persistConnection, refreshPendingCalendarCount, withGoogle]);

  const selectCalendar = useCallback(
    async (calendarId: string, summary: string) => {
      if (!connection) return;
      await persistConnection({
        googleSub: connection.google_sub,
        googleEmail: connection.google_email,
        calendarId,
        calendarSummary: summary,
        calendarStatus: "connected",
      });
    },
    [connection, persistConnection],
  );

  const createBookingEvent = useCallback(
    async (bookingId: string) => {
      if (!connection) throw new Error("Connect Google first.");
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
        const calendarId = payload.calendarId || connection.calendar_id || "primary";
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
      });
    },
    [connection, persistCalendarResult, withGoogle],
  );

  const updateBookingEvent = useCallback(
    async (bookingId: string) => {
      if (!connection) throw new Error("Connect Google first.");
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
      });
    },
    [connection, persistCalendarResult, withGoogle],
  );

  const unlinkBookingEvent = useCallback(
    async (bookingId: string) => {
      if (!connection) return;
      const payload = await readJson<{
        eventId: string | null;
        calendarId: string | null;
      }>(await fetch(`/api/google/calendar?bookingId=${bookingId}`));
      await persistCalendarResult({
        bookingId,
        googleCalendarId: payload.calendarId ?? connection.calendar_id ?? "primary",
        googleEventId: payload.eventId ?? "unlinked",
        syncStatus: "synced",
        unlink: true,
      });
    },
    [connection, persistCalendarResult],
  );

  const createOutreachCalendarEvent = useCallback(
    async (event: GoogleCalendarEventWrite) => {
      if (!connection) throw new Error("Connect Google first.");
      return withGoogle(async (token) => {
        const calendarId = connection.calendar_id || "primary";
        const created = await createGoogleCalendarEvent(token, calendarId, event);
        if (!created.id) throw new Error("Google Calendar did not return an event ID.");
        return {
          id: created.id,
          calendarId,
          htmlLink: created.htmlLink,
          hangoutLink: googleMeetHangoutLink(created),
        };
      });
    },
    [connection, withGoogle],
  );

  const value = useMemo<GoogleSessionValue>(
    () => ({
      clientId,
      connection,
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
      <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" />
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

export function hasGmailScope(tokenScope: string | undefined) {
  return !tokenScope || tokenScope.includes(GMAIL_SCOPE) || tokenScope.includes("gmail");
}

export function hasCalendarScope(tokenScope: string | undefined) {
  return !tokenScope || tokenScope.includes(CALENDAR_EVENTS_SCOPE) || tokenScope.includes("calendar");
}
