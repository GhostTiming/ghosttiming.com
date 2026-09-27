export const GMAIL_AUTO_SYNC_MESSAGE_CAP = 40;
export const GMAIL_AUTO_SYNC_PAGE_BUDGET = 20;
export const GMAIL_AUTO_BOOTSTRAP_DAYS = 14;

export function gmailAutoCatchupQuery(lastSyncedAt: string | null, now = new Date()) {
  const oldest = new Date(now);
  oldest.setUTCDate(oldest.getUTCDate() - GMAIL_AUTO_BOOTSTRAP_DAYS);
  let start = oldest;
  if (lastSyncedAt) {
    const synced = new Date(lastSyncedAt);
    if (!Number.isNaN(synced.valueOf())) {
      synced.setUTCDate(synced.getUTCDate() - 1);
      if (synced > oldest) start = synced;
    }
  }
  const stamp = start.toISOString().slice(0, 10).replaceAll("-", "/");
  return ` after:${stamp}`;
}

export function shouldSaveGmailCursor(input: {
  reachedEnd: boolean;
  pagesScanned: number;
  pageBudget: number;
  unknownCount: number;
  cap: number;
}) {
  if (input.unknownCount > input.cap) return false;
  if (input.reachedEnd) return true;
  return input.pagesScanned >= input.pageBudget && input.unknownCount === 0;
}
