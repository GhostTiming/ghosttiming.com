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

export function listingSearchText(listing: {
  name: string;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zipcode?: string | null;
}) {
  return [
    listing.name,
    listing.street,
    listing.city,
    listing.state,
    listing.zipcode,
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

export const catalogListingSearchHaystackSql = `lower(concat_ws(' ', name, street, city, state, zipcode))`;

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
