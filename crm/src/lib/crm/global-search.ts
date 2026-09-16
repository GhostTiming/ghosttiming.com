export const SEARCH_GROUP_LIMIT = 6;
export const SEARCH_QUERY_MIN_LENGTH = 2;
export const SEARCH_QUERY_MAX_LENGTH = 200;

export const SEARCH_GROUPS = [
  { key: "bookings", label: "Bookings", access: "bookings" },
  { key: "contacts", label: "Contacts", access: "contacts" },
  { key: "organizations", label: "Organizations", access: "organizations" },
  { key: "events", label: "Events", access: "events" },
  { key: "prospects", label: "Prospects", access: "prospects" },
  { key: "tasks", label: "Tasks", access: "tasks" },
] as const;

export const SEARCH_PRIMARY_GROUP_KEYS = ["bookings", "prospects", "tasks"] as const;
export const SEARCH_MORE_GROUP_KEYS = ["contacts", "organizations", "events"] as const;

export type SearchGroupKey = (typeof SEARCH_GROUPS)[number]["key"];

export type SearchAccess = {
  bookings: boolean;
  contacts: boolean;
  organizations: boolean;
  events: boolean;
  prospects: boolean;
  tasks: boolean;
};

export type SearchHit = {
  id: string;
  href: string;
  label: string;
  secondary: string | null;
};

export type SearchResults = Record<SearchGroupKey, SearchHit[]>;

export function emptySearchResults(): SearchResults {
  return {
    bookings: [],
    contacts: [],
    organizations: [],
    events: [],
    prospects: [],
    tasks: [],
  };
}

export function searchAccessFromContext(access: {
  canAccessOperations: boolean;
  canAccessProspecting: boolean;
  canAccessTasks: boolean;
}): SearchAccess {
  return {
    bookings: access.canAccessOperations,
    contacts: access.canAccessOperations || access.canAccessProspecting,
    organizations: access.canAccessOperations,
    events: access.canAccessOperations,
    prospects: access.canAccessProspecting,
    tasks: access.canAccessTasks,
  };
}

export function parseSearchQuery(
  raw: string,
  minLength = SEARCH_QUERY_MIN_LENGTH,
) {
  const query = raw.trim().replace(/\s+/g, " ");
  if (query.length < minLength) return null;
  return query.slice(0, SEARCH_QUERY_MAX_LENGTH);
}

export function searchLikeNeedle(query: string) {
  return query.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export function joinSearchSecondary(
  parts: Array<string | null | undefined>,
): string | null {
  const cleaned = parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  return cleaned.length ? cleaned.join(" · ") : null;
}

export function searchHitHref(
  group: SearchGroupKey,
  id: string,
  related?: { bookingId?: string | null; prospectId?: string | null },
) {
  switch (group) {
    case "bookings":
      return `/bookings/${id}`;
    case "contacts":
      return `/contacts/${id}`;
    case "organizations":
      return `/organizations/${id}`;
    case "events":
      return `/events/${id}`;
    case "prospects":
      return `/prospecting/${id}`;
    case "tasks":
      if (related?.bookingId) return `/bookings/${related.bookingId}`;
      if (related?.prospectId) return `/prospecting/${related.prospectId}`;
      return "/tasks";
  }
}

export function groupedSearchResults(
  results: SearchResults,
  access: SearchAccess,
) {
  return SEARCH_GROUPS.filter(
    (group) => access[group.access] && results[group.key].length > 0,
  ).map((group) => ({
    key: group.key,
    label: group.label,
    hits: results[group.key],
  }));
}

export type SearchGroupList = ReturnType<typeof groupedSearchResults>;

export function partitionSearchGroups(groups: SearchGroupList) {
  const primary = groups.filter((group) =>
    (SEARCH_PRIMARY_GROUP_KEYS as readonly string[]).includes(group.key),
  );
  const more = groups.filter((group) =>
    (SEARCH_MORE_GROUP_KEYS as readonly string[]).includes(group.key),
  );
  return { primary, more };
}

export function flattenSearchHits(
  groups: ReturnType<typeof groupedSearchResults>,
) {
  return groups.flatMap((group) =>
    group.hits.map((hit) => ({ group: group.key, ...hit })),
  );
}
