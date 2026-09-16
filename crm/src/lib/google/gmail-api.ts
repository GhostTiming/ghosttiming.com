import { googleFetch } from "./google-fetch";
import type { GmailMessage } from "./gmail-parse";

type MessageList = {
  messages?: { id: string; threadId?: string }[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
};

type HistoryList = {
  history?: Array<{
    messagesAdded?: Array<{ message?: { id?: string } }>;
  }>;
  nextPageToken?: string;
  historyId?: string;
};

export type GmailProfile = {
  emailAddress: string;
  historyId: string;
};

export function getGmailProfile(accessToken: string) {
  return googleFetch<GmailProfile>(
    accessToken,
    "https://gmail.googleapis.com/gmail/v1/users/me/profile",
  );
}

export async function listGmailMessageIds(
  accessToken: string,
  query: string,
  onPage?: (ids: string[], page: number) => void,
) {
  const ids: string[] = [];
  let pageToken: string | undefined;
  let page = 0;
  do {
    const params = new URLSearchParams({
      q: query,
      maxResults: "100",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const result = await googleFetch<MessageList>(
      accessToken,
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`,
    );
    const pageIds = (result.messages ?? []).map((message) => message.id).filter(Boolean);
    ids.push(...pageIds);
    page += 1;
    onPage?.(pageIds, page);
    pageToken = result.nextPageToken;
  } while (pageToken);
  return ids;
}

export function getGmailMessage(accessToken: string, id: string) {
  return googleFetch<GmailMessage>(
    accessToken,
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`,
  );
}

export async function listGmailHistoryMessageIds(
  accessToken: string,
  startHistoryId: string,
) {
  const ids = new Set<string>();
  let pageToken: string | undefined;
  let historyId = startHistoryId;
  do {
    const params = new URLSearchParams({
      startHistoryId,
      historyTypes: "messageAdded",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const result = await googleFetch<HistoryList>(
      accessToken,
      `https://gmail.googleapis.com/gmail/v1/users/me/history?${params}`,
    );
    for (const record of result.history ?? []) {
      for (const added of record.messagesAdded ?? []) {
        if (added.message?.id) ids.add(added.message.id);
      }
    }
    historyId = result.historyId ?? historyId;
    pageToken = result.nextPageToken;
  } while (pageToken);
  return { ids: [...ids], historyId };
}
