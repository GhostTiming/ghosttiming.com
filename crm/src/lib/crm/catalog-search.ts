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

export function listingSearchText(listing: {
  id?: string | number | null;
  name: string;
  slug?: string | null;
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
    listing.id == null ? null : String(listing.id),
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
  const tokens = catalogSearchTokens(query, 1);
  if (!tokens.length) return true;
  const haystack = listingSearchText(listing);
  return tokens.every((token) => haystack.includes(token));
}

export const catalogListingSearchHaystackSql = `lower(concat_ws(' ', name, slug, id::text, street, city, state, zipcode, to_char(next_start_at, 'YYYY'), (
  SELECT MAX(edition_year)::text
  FROM catalog.race_editions
  WHERE race_listing_id = catalog.race_listings.id
)))`;

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
