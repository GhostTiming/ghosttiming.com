import "server-only";

import { getPool } from "@/db";
import { bookingOrgScopeParam, effectiveAccessUserId, type AccessContext } from "@/lib/auth/access";
import { loadContactOrgScope } from "./contact-queries";
import { personInContactScopeSql, personMatchesProspectContactSql } from "./contacts";
import { formatTaskHeadline } from "./domain";
import {
  SEARCH_GROUP_LIMIT,
  emptySearchResults,
  groupedSearchResults,
  joinSearchSecondary,
  parseSearchQuery,
  searchAccessFromContext,
  searchHitHref,
  searchLikeNeedle,
  type SearchHit,
} from "./global-search";
import { personEmailMatchesSql, personNameMatchesSql } from "./person-search";

const like = (column: string, param: string) =>
  `${column} ILIKE '%' || ${param} || '%' ESCAPE '\\'`;

const linkedContactEmailSql = personEmailMatchesSql("$1", { escape: true });

const contactLinkedRaceNamesSql = `
  (
    SELECT string_agg(race_name, ', ' ORDER BY race_name)
    FROM (
      SELECT DISTINCT race_name
      FROM (
        SELECT COALESCE(linked_event.name, listing.name) AS race_name
        FROM crm.prospects prospect
        LEFT JOIN crm.events linked_event ON linked_event.id = prospect.event_id
        LEFT JOIN catalog.race_listings listing
          ON listing.id = prospect.race_listing_id
        WHERE prospect.primary_contact_person_id = person.id
          AND prospect.archived_at IS NULL
        UNION
        SELECT booking_event.name
        FROM crm.bookings booking
        JOIN crm.event_occurrences occurrence
          ON occurrence.id = booking.occurrence_id
        JOIN crm.events booking_event ON booking_event.id = occurrence.event_id
        WHERE booking.primary_contact_person_id = person.id
          AND booking.archived_at IS NULL
          AND booking_event.archived_at IS NULL
      ) named
      WHERE race_name IS NOT NULL AND btrim(race_name) <> ''
      ORDER BY race_name
      LIMIT 2
    ) races
  )
`;

function mapHits(
  rows: Array<{ id: string; label: string; secondary: string | null }>,
  group: Parameters<typeof searchHitHref>[0],
  related?: (row: { id: string }) => {
    bookingId?: string | null;
    prospectId?: string | null;
  },
): SearchHit[] {
  return rows.map((row) => ({
    id: row.id,
    href: searchHitHref(group, row.id, related?.(row)),
    label: row.label,
    secondary: row.secondary,
  }));
}

export async function searchCrmRecords(access: AccessContext, rawQuery: string) {
  const query = parseSearchQuery(rawQuery);
  const visibility = searchAccessFromContext(access);
  if (!query) {
    return { query: null, groups: [] as ReturnType<typeof groupedSearchResults> };
  }

  const needle = searchLikeNeedle(query);
  const orgScope = bookingOrgScopeParam(access);
  const contactScope = visibility.contacts
    ? await loadContactOrgScope(access)
    : { scopeOrgIds: [] as string[] | null, assignedOrgIds: [] as string[] | null };
  const pool = getPool();
  const results = emptySearchResults();
  const searches: Array<Promise<void>> = [];

  if (visibility.bookings) {
    searches.push(
      pool
        .query<{ id: string; label: string; secondary: string | null }>(
          `
            SELECT
              booking.id::text,
              event.name AS label,
              NULLIF(concat_ws(' · ',
                NULLIF(concat_ws(', ',
                  NULLIF(COALESCE(occurrence.city_override, listing.city), ''),
                  NULLIF(COALESCE(occurrence.state_override, listing.state), '')
                ), ''),
                NULLIF(client.name, ''),
                NULLIF(stage.name, '')
              ), '') AS secondary
            FROM crm.bookings booking
            JOIN crm.event_occurrences occurrence
              ON occurrence.id = booking.occurrence_id
            JOIN crm.events event ON event.id = occurrence.event_id
            JOIN crm.organizations client
              ON client.id = booking.direct_client_organization_id
            JOIN crm.pipeline_stages stage ON stage.id = booking.stage_id
            LEFT JOIN catalog.race_listings listing
              ON listing.id = event.catalog_race_listing_id
            WHERE booking.archived_at IS NULL
              AND event.archived_at IS NULL
              AND ($2::uuid[] IS NULL
                OR booking.direct_client_organization_id = ANY($2::uuid[]))
              AND (
                ${like("event.name", "$1")}
                OR ${like("client.name", "$1")}
                OR ${like("COALESCE(occurrence.city_override, listing.city, '')", "$1")}
                OR ${like("COALESCE(occurrence.state_override, listing.state, '')", "$1")}
                OR ${like("COALESCE(occurrence.street_override, listing.street, '')", "$1")}
                OR ${like("COALESCE(occurrence.zipcode_override, listing.zipcode, '')", "$1")}
                OR EXISTS (
                  SELECT 1
                  FROM crm.people person
                  WHERE person.id = booking.primary_contact_person_id
                    AND ${linkedContactEmailSql}
                )
                OR EXISTS (
                  SELECT 1
                  FROM crm.crew_assignments crew
                  JOIN crm.people person ON person.id = crew.person_id
                  WHERE crew.occurrence_id = booking.occurrence_id
                    AND ${linkedContactEmailSql}
                )
              )
            ORDER BY occurrence.race_date DESC NULLS LAST, event.name
            LIMIT ${SEARCH_GROUP_LIMIT}
          `,
          [needle, orgScope],
        )
        .then((result) => {
          results.bookings = mapHits(result.rows, "bookings");
        }),
    );
  }

  if (visibility.organizations) {
    searches.push(
      pool
        .query<{ id: string; label: string; secondary: string | null }>(
          `
            SELECT
              org.id::text,
              org.name AS label,
              NULLIF(concat_ws(' · ',
                NULLIF(org.city, ''),
                NULLIF(org.state, ''),
                NULLIF(org.email, '')
              ), '') AS secondary
            FROM crm.organizations org
            WHERE org.is_active
              AND org.archived_at IS NULL
              AND ($2::uuid[] IS NULL OR org.id = ANY($2::uuid[]))
              AND (
                ${like("org.name", "$1")}
                OR ${like("COALESCE(org.email, '')", "$1")}
                OR ${like("COALESCE(org.city, '')", "$1")}
                OR ${like("COALESCE(org.state, '')", "$1")}
              )
            ORDER BY org.name
            LIMIT ${SEARCH_GROUP_LIMIT}
          `,
          [needle, orgScope],
        )
        .then((result) => {
          results.organizations = mapHits(result.rows, "organizations");
        }),
    );
  }

  if (visibility.events) {
    searches.push(
      pool
        .query<{ id: string; label: string; secondary: string | null }>(
          `
            SELECT
              event.id::text,
              event.name AS label,
              NULLIF(concat_ws(' · ',
                NULLIF(owner.name, ''),
                NULLIF(listing.city, ''),
                NULLIF(listing.state, '')
              ), '') AS secondary
            FROM crm.events event
            LEFT JOIN crm.organizations owner
              ON owner.id = event.default_owner_organization_id
            LEFT JOIN catalog.race_listings listing
              ON listing.id = event.catalog_race_listing_id
            WHERE event.archived_at IS NULL
              AND (
                $2::uuid[] IS NULL
                OR EXISTS (
                  SELECT 1
                  FROM crm.bookings booking
                  JOIN crm.event_occurrences booked
                    ON booked.id = booking.occurrence_id
                  WHERE booked.event_id = event.id
                    AND booking.archived_at IS NULL
                    AND booking.direct_client_organization_id = ANY($2::uuid[])
                )
              )
              AND (
                ${like("event.name", "$1")}
                OR ${like("COALESCE(owner.name, '')", "$1")}
                OR ${like("COALESCE(listing.city, '')", "$1")}
                OR ${like("COALESCE(listing.state, '')", "$1")}
                OR EXISTS (
                  SELECT 1
                  FROM crm.prospects prospect
                  JOIN crm.people person
                    ON person.id = prospect.primary_contact_person_id
                  WHERE prospect.event_id = event.id
                    AND prospect.archived_at IS NULL
                    AND ${linkedContactEmailSql}
                )
                OR EXISTS (
                  SELECT 1
                  FROM crm.bookings booking
                  JOIN crm.event_occurrences booked
                    ON booked.id = booking.occurrence_id
                  JOIN crm.people person
                    ON person.id = booking.primary_contact_person_id
                  WHERE booked.event_id = event.id
                    AND booking.archived_at IS NULL
                    AND ${linkedContactEmailSql}
                )
                OR EXISTS (
                  SELECT 1
                  FROM crm.crew_assignments crew
                  JOIN crm.event_occurrences crewed
                    ON crewed.id = crew.occurrence_id
                  JOIN crm.people person ON person.id = crew.person_id
                  WHERE crewed.event_id = event.id
                    AND ${linkedContactEmailSql}
                )
              )
            ORDER BY event.name
            LIMIT ${SEARCH_GROUP_LIMIT}
          `,
          [needle, orgScope],
        )
        .then((result) => {
          results.events = mapHits(result.rows, "events");
        }),
    );
  }

  if (visibility.prospects) {
    searches.push(
      pool
        .query<{ id: string; label: string; secondary: string | null }>(
          `
            SELECT
              prospect.id::text,
              COALESCE(event.name, listing.name, 'Prospect') AS label,
              NULLIF(concat_ws(' · ',
                NULLIF(concat_ws(', ',
                  NULLIF(COALESCE(occurrence.city_override, listing.city), ''),
                  NULLIF(COALESCE(occurrence.state_override, listing.state), '')
                ), ''),
                NULLIF(stage.name, '')
              ), '') AS secondary
            FROM crm.prospects prospect
            JOIN crm.pipeline_stages stage ON stage.id = prospect.stage_id
            LEFT JOIN crm.events event ON event.id = prospect.event_id
            LEFT JOIN catalog.race_listings listing
              ON listing.id = COALESCE(prospect.race_listing_id, event.catalog_race_listing_id)
            LEFT JOIN crm.event_occurrences occurrence
              ON occurrence.id = prospect.occurrence_id
            WHERE prospect.archived_at IS NULL
              AND (
                ${like("COALESCE(event.name, listing.name, '')", "$1")}
                OR ${like("COALESCE(occurrence.city_override, listing.city, '')", "$1")}
                OR ${like("COALESCE(occurrence.state_override, listing.state, '')", "$1")}
                OR EXISTS (
                  SELECT 1
                  FROM crm.people person
                  WHERE person.id = prospect.primary_contact_person_id
                    AND ${linkedContactEmailSql}
                )
              )
            ORDER BY COALESCE(occurrence.race_date, listing.next_start_at) DESC NULLS LAST
            LIMIT ${SEARCH_GROUP_LIMIT}
          `,
          [needle],
        )
        .then((result) => {
          results.prospects = mapHits(result.rows, "prospects");
        }),
    );
  }

  if (visibility.contacts) {
    const operations = access.canAccessOperations;
    const prospecting = access.canAccessProspecting;
    const contactFilter = operations
      ? prospecting
        ? `(${personInContactScopeSql(2, 3)} OR ${personMatchesProspectContactSql()})`
        : personInContactScopeSql(2, 3)
      : personMatchesProspectContactSql();
    searches.push(
      pool
        .query<{ id: string; label: string; secondary: string | null }>(
          `
            SELECT
              person.id::text,
              COALESCE(
                NULLIF(person.display_name, ''),
                NULLIF(trim(concat_ws(' ', person.first_name, person.last_name)), ''),
                person.email,
                'Unnamed contact'
              ) AS label,
              NULLIF(concat_ws(' · ',
                NULLIF(person.email, ''),
                ${contactLinkedRaceNamesSql},
                NULLIF(org.name, ''),
                NULLIF(person.city, ''),
                NULLIF(person.state, '')
              ), '') AS secondary
            FROM crm.people person
            LEFT JOIN crm.organizations org ON org.id = person.organization_id
            WHERE person.archived_at IS NULL
              AND person.is_active
              AND ${contactFilter}
              AND (
                ${personNameMatchesSql("$1", {
                  includeEmail: true,
                  includePhone: true,
                  escape: true,
                })}
                OR ${like("COALESCE(org.name, '')", "$1")}
              )
            ORDER BY label
            LIMIT ${SEARCH_GROUP_LIMIT}
          `,
          [needle, contactScope.scopeOrgIds, contactScope.assignedOrgIds],
        )
        .then((result) => {
          results.contacts = mapHits(result.rows, "contacts");
        }),
    );
  }

  if (visibility.tasks) {
    searches.push(
      pool
        .query<{
          id: string;
          title: string;
          notes: string | null;
          status: string;
          race_name: string | null;
          prospect_id: string | null;
          booking_id: string | null;
        }>(
          `
            SELECT
              t.id::text,
              t.title,
              t.notes,
              t.status::text,
              COALESCE(rl.name, prospect_event.name, booking_event.name, organization.name)
                AS race_name,
              p.id::text AS prospect_id,
              booking.id::text AS booking_id
            FROM crm.tasks t
            JOIN crm.users u ON u.id = t.assigned_user_id
            LEFT JOIN crm.prospects p ON p.id = t.prospect_id
            LEFT JOIN catalog.race_listings rl ON rl.id = p.race_listing_id
            LEFT JOIN crm.events prospect_event ON prospect_event.id = p.event_id
            LEFT JOIN crm.bookings booking ON booking.id = t.booking_id
            LEFT JOIN crm.event_occurrences occurrence
              ON occurrence.id = booking.occurrence_id
            LEFT JOIN crm.events booking_event ON booking_event.id = occurrence.event_id
            LEFT JOIN crm.organizations organization ON organization.id = t.organization_id
            WHERE (
              $2::boolean
              OR t.assigned_user_id = $3::uuid
              OR (
                $4::uuid[] IS NOT NULL
                AND (
                  t.organization_id = ANY($4::uuid[])
                  OR booking.direct_client_organization_id = ANY($4::uuid[])
                )
              )
            )
            AND (
              ${like("t.title", "$1")}
              OR ${like("COALESCE(t.notes, '')", "$1")}
              OR ${like("COALESCE(rl.name, prospect_event.name, booking_event.name, organization.name, '')", "$1")}
            )
            ORDER BY
              CASE WHEN t.status = 'open' THEN 0 ELSE 1 END,
              t.due_at ASC
            LIMIT ${SEARCH_GROUP_LIMIT}
          `,
          [
            needle,
            access.isSuperAdmin,
            effectiveAccessUserId(access),
            access.isSuperAdmin ? null : access.assignedOrgIds,
          ],
        )
        .then((result) => {
          results.tasks = result.rows.map((row) => ({
            id: row.id,
            href: searchHitHref("tasks", row.id, {
              bookingId: row.booking_id,
              prospectId: row.prospect_id,
            }),
            label: formatTaskHeadline(row.title, row.notes),
            secondary: joinSearchSecondary([row.race_name, row.status]),
          }));
        }),
    );
  }

  await Promise.all(searches);
  return {
    query,
    groups: groupedSearchResults(results, visibility),
  };
}

export type CrmSearchResponse = Awaited<ReturnType<typeof searchCrmRecords>>;
