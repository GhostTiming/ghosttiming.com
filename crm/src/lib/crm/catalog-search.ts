export function catalogSearchTokens(query: string, minLength = 1) {
  return query
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= minLength)
    .slice(0, 8);
}

export function catalogSearchLikeNeedles(query: string) {
  return catalogSearchTokens(query, 2)
    .map((token) => token.replace(/[%_\\]/g, ""))
    .filter((token) => token.length >= 2);
}

/** Pure numeric queries are treated as GRV/RunSignup ids (listing id, race id, or event id). */
export function catalogSearchIdNeedle(query: string) {
  const trimmed = query.trim();
  if (!/^\d{4,}$/.test(trimmed)) return null;
  return trimmed;
}

export function catalogListingSearchQuery(event: {
  name?: string | null;
  city?: string | null;
  state?: string | null;
}) {
  return [event.name, event.city, event.state]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" ");
}

export function listingEventYear(
  nextStartAt: string | Date | null | undefined,
  editionYear?: number | string | null,
): string | null {
  if (!nextStartAt) {
    if (editionYear == null || editionYear === "") return null;
    const year = String(editionYear);
    return /^\d{4}$/.test(year) ? year : null;
  }
  if (nextStartAt instanceof Date && !Number.isNaN(nextStartAt.valueOf())) {
    return String(nextStartAt.getUTCFullYear());
  }
  const match = String(nextStartAt).trim().match(/^(\d{4})/);
  return match?.[1] ?? listingEventYear(null, editionYear);
}

/** Extra searchable text derived from a GRV slug (spaced tokens + trailing event id). */
export function slugSearchExtras(slug?: string | null) {
  if (!slug?.trim()) return [] as string[];
  const value = slug.trim();
  const spaced = value.replace(/-/g, " ");
  const trailingId = value.match(/-(\d{4,})$/)?.[1];
  return trailingId && trailingId !== spaced ? [spaced, trailingId] : [spaced];
}

export function listingSearchText(listing: {
  id?: string | number | null;
  name: string;
  slug?: string | null;
  source_race_id?: string | number | null;
  source_event_ids?: Array<string | number> | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zipcode?: string | null;
  next_start_at?: string | Date | null;
  edition_year?: number | string | null;
}) {
  return [
    listing.name,
    listing.slug,
    ...slugSearchExtras(listing.slug),
    listing.id == null ? null : String(listing.id),
    listing.source_race_id == null ? null : String(listing.source_race_id),
    ...(listing.source_event_ids ?? []).map((id) => String(id)),
    listing.street,
    listing.city,
    listing.state,
    listing.zipcode,
    listingEventYear(listing.next_start_at, listing.edition_year),
  ]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(" ")
    .toLowerCase();
}

export function listingMatchesSearch(
  listing: Parameters<typeof listingSearchText>[0],
  query: string,
) {
  const idNeedle = catalogSearchIdNeedle(query);
  const haystack = listingSearchText(listing);
  if (idNeedle) return haystack.includes(idNeedle.toLowerCase());

  const tokens = catalogSearchTokens(query, 1);
  if (!tokens.length) return true;
  return tokens.every((token) => haystack.includes(token));
}

/**
 * Search across display fields plus GRV identifiers:
 * listing UUID, slug (raw + hyphen-spaced), source_race_id, and legacy source_event_ids.
 */
export const catalogListingSearchHaystackSql = `lower(concat_ws(' ',
  name,
  slug,
  replace(slug, '-', ' '),
  id::text,
  source_race_id::text,
  street,
  city,
  state,
  zipcode,
  to_char(next_start_at, 'YYYY'),
  (
    SELECT MAX(edition_year)::text
    FROM catalog.race_editions
    WHERE race_listing_id = catalog.race_listings.id
  ),
  (
    SELECT string_agg(DISTINCT source_event_id::text, ' ')
    FROM catalog.legacy_event_identity_map
    WHERE race_listing_id = catalog.race_listings.id
      AND source_event_id IS NOT NULL
  )
))`;

export function catalogListingSearchWhereSql(
  tokenCount: number,
  startParam = 1,
) {
  return Array.from(
    { length: tokenCount },
    (_, index) =>
      `${catalogListingSearchHaystackSql} LIKE '%' || $${startParam + index} || '%'`,
  ).join(" AND ");
}

/** Single numeric id queries match any id-bearing field without AND-ing name tokens. */
export function catalogListingSearchIdWhereSql(startParam = 1) {
  return `${catalogListingSearchHaystackSql} LIKE '%' || $${startParam} || '%'`;
}
