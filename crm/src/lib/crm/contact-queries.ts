import type { PoolClient } from "pg";
import { getPool } from "@/db";
import type { AccessContext } from "@/lib/auth/access";
import {
  expandContactOrgScope,
  personInContactScopeSql,
  personIsCrewContactSql,
  personIsDirectClientContactSql,
  personIsEventClientContactSql,
  personListStatusSql,
  personMatchesProspectContactSql,
  uniqueIds,
  type ContactEventAssociation,
} from "./contacts";
import { personNameMatchesSql } from "./person-search";

export type ContactOrgScope = {
  scopeOrgIds: string[] | null;
  assignedOrgIds: string[] | null;
};

export async function loadContactOrgScope(
  access: Pick<AccessContext, "isSuperAdmin" | "assignedOrgIds">,
): Promise<ContactOrgScope> {
  if (access.isSuperAdmin) {
    return { scopeOrgIds: null, assignedOrgIds: null };
  }
  const assignedOrgIds = access.assignedOrgIds;
  if (!assignedOrgIds.length) {
    return { scopeOrgIds: [], assignedOrgIds: [] };
  }
  const related = await getPool().query<{ id: string }>(
    `
      SELECT DISTINCT occurrence.event_owner_organization_id::text AS id
      FROM crm.bookings booking
      JOIN crm.event_occurrences occurrence ON occurrence.id = booking.occurrence_id
      WHERE booking.direct_client_organization_id = ANY($1::uuid[])
        AND occurrence.event_owner_organization_id IS NOT NULL
    `,
    [assignedOrgIds],
  );
  return {
    assignedOrgIds,
    scopeOrgIds: expandContactOrgScope({
      assignedOrgIds,
      relatedEventOwnerOrgIds: related.rows.map((row) => row.id),
    }),
  };
}

export async function listAttachableOrganizations(scopeOrgIds: string[] | null) {
  return getPool().query<{ id: string; name: string }>(
    `
      SELECT id::text, name
      FROM crm.organizations
      WHERE is_active AND archived_at IS NULL
        AND ($1::uuid[] IS NULL OR id = ANY($1::uuid[]))
      ORDER BY name
    `,
    [scopeOrgIds],
  );
}

export async function replacePersonOrganizations(
  client: PoolClient,
  personId: string,
  organizationIds: string[],
) {
  await client.query(
    `DELETE FROM crm.person_organizations WHERE person_id = $1::uuid`,
    [personId],
  );
  if (!organizationIds.length) return;
  await client.query(
    `
      INSERT INTO crm.person_organizations (person_id, organization_id)
      SELECT $1::uuid, unnest($2::uuid[])
    `,
    [personId, uniqueIds(organizationIds)],
  );
}

const personDisplayNameSql = `
  COALESCE(
    NULLIF(person.display_name, ''),
    NULLIF(trim(concat_ws(' ', person.first_name, person.last_name)), ''),
    person.email,
    'Unnamed contact'
  )
`;

export type PersonContactRow = {
  id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  organization_names: string[];
};

export type EventContactRow = PersonContactRow & {
  event_names: string[];
};

export type ProspectContactRow = {
  id: string;
  href: string | null;
  display_name: string;
  email: string | null;
  phone: string | null;
  race_name: string | null;
};

export type ContactListQuery = {
  status: "active" | "inactive" | "archived";
  q: string | null;
  email: string;
  phone: string;
  organization?: string | null;
  event?: string | null;
  race?: string | null;
  sortSql: string;
  direction: "ASC" | "DESC";
};

const personSearchSql = personNameMatchesSql("$4", {
  includeEmail: true,
});

const emailPresenceSql = `
  (
    $5::text IS NULL OR $5::text = 'all'
    OR ($5::text = 'has' AND person.email IS NOT NULL AND person.email <> '')
    OR ($5::text = 'missing' AND (person.email IS NULL OR person.email = ''))
  )
`;

const phonePresenceSql = `
  (
    $6::text IS NULL OR $6::text = 'all'
    OR ($6::text = 'has' AND person.phone IS NOT NULL AND person.phone <> '')
    OR ($6::text = 'missing' AND (person.phone IS NULL OR person.phone = ''))
  )
`;

const organizationHavingSql = `
  (
    $7::text IS NULL
    OR COALESCE(
      array_to_string(
        array_agg(DISTINCT org.name) FILTER (WHERE org.name IS NOT NULL),
        ' '
      ),
      ''
    ) ILIKE '%' || $7::text || '%'
  )
`;

const personOrgTiesJoin = `
  LEFT JOIN (
    SELECT person_id, organization_id FROM crm.person_organizations
    UNION
    SELECT id, organization_id FROM crm.people
    WHERE organization_id IS NOT NULL
  ) ties ON ties.person_id = person.id
`;

const personContactSelectSql = `
  person.id::text,
  ${personDisplayNameSql} AS display_name,
  person.email,
  person.phone,
  COALESCE(
    array_agg(DISTINCT org.name ORDER BY org.name)
      FILTER (WHERE org.name IS NOT NULL),
    ARRAY[]::text[]
  ) AS organization_names
`;

const eventNamesSelectSql = `
  COALESCE(
    array_agg(DISTINCT listed_event.name ORDER BY listed_event.name)
      FILTER (WHERE listed_event.name IS NOT NULL),
    ARRAY[]::text[]
  ) AS event_names
`;

const eventHavingSql = `
  (
    $8::text IS NULL
    OR COALESCE(
      array_to_string(
        array_agg(DISTINCT listed_event.name)
          FILTER (WHERE listed_event.name IS NOT NULL),
        ' '
      ),
      ''
    ) ILIKE '%' || $8::text || '%'
  )
`;

function personListParams(scope: ContactOrgScope, query: ContactListQuery) {
  return [
    scope.scopeOrgIds,
    scope.assignedOrgIds,
    query.status,
    query.q,
    query.email,
    query.phone,
    query.organization?.trim() || null,
  ];
}

export async function listDirectClientContacts(
  scope: ContactOrgScope,
  query: ContactListQuery,
) {
  return getPool().query<PersonContactRow>(
    `
      SELECT
        ${personContactSelectSql}
      FROM crm.people person
      ${personOrgTiesJoin}
      LEFT JOIN crm.organizations org
        ON org.id = ties.organization_id
       AND EXISTS (
         SELECT 1 FROM crm.organization_roles role
         WHERE role.organization_id = org.id
           AND role.role = 'direct_client'
       )
      WHERE ${personListStatusSql(3)}
        AND ${personInContactScopeSql(1, 2)}
        AND ${personIsDirectClientContactSql()}
        AND ${personSearchSql}
        AND ${emailPresenceSql}
        AND ${phonePresenceSql}
      GROUP BY person.id
      HAVING ${organizationHavingSql}
      ORDER BY ${query.sortSql} ${query.direction} NULLS LAST, display_name
    `,
    personListParams(scope, query),
  );
}

export async function listEventClientContacts(
  scope: ContactOrgScope,
  query: ContactListQuery,
) {
  return getPool().query<EventContactRow>(
    `
      SELECT
        ${personContactSelectSql},
        ${eventNamesSelectSql}
      FROM crm.people person
      ${personOrgTiesJoin}
      LEFT JOIN crm.organizations org ON org.id = ties.organization_id
      LEFT JOIN crm.bookings listed_booking
        ON listed_booking.archived_at IS NULL
       AND (
         listed_booking.primary_contact_person_id = person.id
         OR EXISTS (
           SELECT 1
           FROM crm.event_occurrences owner_occurrence
           WHERE owner_occurrence.id = listed_booking.occurrence_id
             AND owner_occurrence.event_owner_organization_id IS NOT NULL
             AND NOT EXISTS (
               SELECT 1 FROM crm.organization_roles role
               WHERE role.organization_id = owner_occurrence.event_owner_organization_id
                 AND role.role = 'direct_client'
             )
             AND (
               person.organization_id = owner_occurrence.event_owner_organization_id
               OR EXISTS (
                 SELECT 1 FROM crm.person_organizations membership
                 WHERE membership.person_id = person.id
                   AND membership.organization_id =
                     owner_occurrence.event_owner_organization_id
               )
             )
         )
       )
      LEFT JOIN crm.event_occurrences listed_occurrence
        ON listed_occurrence.id = listed_booking.occurrence_id
      LEFT JOIN crm.events listed_event
        ON listed_event.id = listed_occurrence.event_id
      WHERE ${personListStatusSql(3)}
        AND ${personInContactScopeSql(1, 2)}
        AND ${personIsEventClientContactSql()}
        AND ${personSearchSql}
        AND ${emailPresenceSql}
        AND ${phonePresenceSql}
      GROUP BY person.id
      HAVING ${organizationHavingSql}
        AND ${eventHavingSql}
      ORDER BY ${query.sortSql} ${query.direction} NULLS LAST, display_name
    `,
    [...personListParams(scope, query), query.event?.trim() || null],
  );
}

export async function listCrewContacts(
  scope: ContactOrgScope,
  query: ContactListQuery,
) {
  return getPool().query<EventContactRow>(
    `
      SELECT
        ${personContactSelectSql},
        ${eventNamesSelectSql}
      FROM crm.people person
      ${personOrgTiesJoin}
      LEFT JOIN crm.organizations org ON org.id = ties.organization_id
      LEFT JOIN crm.crew_assignments listed_crew
        ON listed_crew.person_id = person.id
      LEFT JOIN crm.bookings listed_booking
        ON listed_booking.occurrence_id = listed_crew.occurrence_id
       AND listed_booking.archived_at IS NULL
      LEFT JOIN crm.event_occurrences listed_occurrence
        ON listed_occurrence.id = listed_booking.occurrence_id
      LEFT JOIN crm.events listed_event
        ON listed_event.id = listed_occurrence.event_id
      WHERE ${personListStatusSql(3)}
        AND ${personInContactScopeSql(1, 2)}
        AND ${personIsCrewContactSql()}
        AND ${personSearchSql}
        AND ${emailPresenceSql}
        AND ${phonePresenceSql}
      GROUP BY person.id
      HAVING ${organizationHavingSql}
        AND ${eventHavingSql}
      ORDER BY ${query.sortSql} ${query.direction} NULLS LAST, display_name
    `,
    [...personListParams(scope, query), query.event?.trim() || null],
  );
}

export async function listProspectContacts(query: ContactListQuery) {
  return getPool().query<ProspectContactRow>(
    `
      SELECT id, href, display_name, email, phone, race_name
      FROM (
        SELECT
          concat('person:', person.id::text) AS id,
          COALESCE(
            (
              SELECT concat('/prospecting/', linked.id::text)
              FROM crm.prospects linked
              WHERE linked.primary_contact_person_id = person.id
              ORDER BY linked.updated_at DESC
              LIMIT 1
            ),
            concat('/contacts/', person.id::text)
          ) AS href,
          ${personDisplayNameSql} AS display_name,
          person.email,
          person.phone,
          NULLIF(
            array_to_string(
              array_agg(DISTINCT COALESCE(event.name, listing.name))
                FILTER (WHERE COALESCE(event.name, listing.name) IS NOT NULL),
              ', '
            ),
            ''
          ) AS race_name
        FROM crm.people person
        LEFT JOIN crm.prospects prospect
          ON prospect.primary_contact_person_id = person.id
        LEFT JOIN crm.events event ON event.id = prospect.event_id
        LEFT JOIN catalog.race_listings listing
          ON listing.id = prospect.race_listing_id
        WHERE ${personMatchesProspectContactSql()}
          AND ${personListStatusSql(1)}
          AND ${personNameMatchesSql("$2", { includeEmail: true, includePhone: true })}
        GROUP BY person.id

        UNION ALL

        SELECT
          concat('method:', method.id::text) AS id,
          CASE
            WHEN related.prospect_id IS NOT NULL
              THEN concat('/prospecting/', related.prospect_id)
            ELSE NULL
          END AS href,
          COALESCE(NULLIF(method.label, ''), 'Listing contact') AS display_name,
          CASE WHEN method.type = 'email' THEN method.raw_value ELSE NULL END AS email,
          CASE WHEN method.type = 'phone' THEN method.raw_value ELSE NULL END AS phone,
          COALESCE(related.race_name, listing.name) AS race_name
        FROM crm.contact_methods method
        LEFT JOIN catalog.race_listings listing
          ON listing.id = method.race_listing_id
        LEFT JOIN LATERAL (
          SELECT
            prospect.id::text AS prospect_id,
            COALESCE(listing.name, event.name) AS race_name,
            prospect.archived_at
          FROM crm.prospects prospect
          LEFT JOIN crm.events event ON event.id = prospect.event_id
          LEFT JOIN catalog.race_listings listing
            ON listing.id = COALESCE(prospect.race_listing_id, method.race_listing_id)
          WHERE prospect.id = method.prospect_id
            OR (
              method.prospect_id IS NULL
              AND method.race_listing_id IS NOT NULL
              AND prospect.race_listing_id = method.race_listing_id
            )
          ORDER BY prospect.archived_at NULLS FIRST, prospect.updated_at DESC
          LIMIT 1
        ) related ON true
        WHERE method.status <> 'invalid'
          AND (
            ($1::text = 'archived' AND related.archived_at IS NOT NULL)
            OR ($1::text = 'inactive' AND false)
            OR ($1::text = 'active' AND related.archived_at IS NULL)
          )
          AND (
            $2::text IS NULL
            OR COALESCE(NULLIF(method.label, ''), '') ILIKE '%' || $2::text || '%'
            OR method.raw_value ILIKE '%' || $2::text || '%'
            OR COALESCE(related.race_name, listing.name, '') ILIKE '%' || $2::text || '%'
          )
          AND NOT EXISTS (
            SELECT 1
            FROM crm.people person
            WHERE (
              (
                method.type = 'email'
                AND person.email IS NOT NULL
                AND lower(btrim(person.email)) = lower(method.normalized_value)
              )
              OR (
                method.type = 'phone'
                AND person.phone IS NOT NULL
                AND regexp_replace(person.phone, '[^0-9]', '', 'g') =
                  regexp_replace(method.normalized_value, '[^0-9]', '', 'g')
                AND regexp_replace(method.normalized_value, '[^0-9]', '', 'g') <> ''
              )
            )
          )
      ) contacts
      WHERE (
        $3::text IS NULL OR $3::text = 'all'
        OR ($3::text = 'has' AND email IS NOT NULL AND email <> '')
        OR ($3::text = 'missing' AND (email IS NULL OR email = ''))
      )
      AND (
        $4::text IS NULL OR $4::text = 'all'
        OR ($4::text = 'has' AND phone IS NOT NULL AND phone <> '')
        OR ($4::text = 'missing' AND (phone IS NULL OR phone = ''))
      )
      AND (
        $5::text IS NULL
        OR COALESCE(race_name, '') ILIKE '%' || $5::text || '%'
      )
      ORDER BY ${query.sortSql} ${query.direction} NULLS LAST, display_name
    `,
    [
      query.status,
      query.q,
      query.email,
      query.phone,
      query.race?.trim() || null,
    ],
  );
}

export type ContactAssociatedEventRow = {
  event_id: string | null;
  event_name: string;
  occurrence_id: string | null;
  occurrence_year: number | null;
  race_date: string | null;
  booking_id: string | null;
  prospect_id: string | null;
  association: ContactEventAssociation;
  role: string | null;
  stage_name: string | null;
};

export async function listContactAssociatedEvents(
  personId: string,
  assignedClientOrgIds: string[] | null = null,
) {
  return getPool().query<ContactAssociatedEventRow>(
    `
      SELECT
        event_id,
        event_name,
        occurrence_id,
        occurrence_year,
        race_date,
        booking_id,
        prospect_id,
        association,
        role,
        stage_name
      FROM (
        SELECT
          event.id::text AS event_id,
          event.name AS event_name,
          occurrence.id::text AS occurrence_id,
          occurrence.occurrence_year,
          occurrence.race_date::text,
          booking.id::text AS booking_id,
          NULL::text AS prospect_id,
          'booking_primary'::text AS association,
          NULL::text AS role,
          stage.name AS stage_name,
          occurrence.race_date AS sort_date,
          event.name AS sort_name
        FROM crm.bookings booking
        JOIN crm.event_occurrences occurrence
          ON occurrence.id = booking.occurrence_id
        JOIN crm.events event ON event.id = occurrence.event_id
        JOIN crm.pipeline_stages stage ON stage.id = booking.stage_id
        WHERE booking.primary_contact_person_id = $1::uuid
          AND (
            $2::uuid[] IS NULL
            OR booking.direct_client_organization_id = ANY($2::uuid[])
          )

        UNION ALL

        SELECT
          event.id::text,
          event.name,
          occurrence.id::text,
          occurrence.occurrence_year,
          occurrence.race_date::text,
          booking.id::text,
          NULL::text,
          'crew'::text,
          crew.role,
          booking_stage.name,
          occurrence.race_date,
          event.name
        FROM crm.crew_assignments crew
        JOIN crm.event_occurrences occurrence
          ON occurrence.id = crew.occurrence_id
        JOIN crm.events event ON event.id = occurrence.event_id
        LEFT JOIN crm.bookings booking
          ON booking.occurrence_id = crew.occurrence_id
         AND booking.archived_at IS NULL
        LEFT JOIN crm.pipeline_stages booking_stage
          ON booking_stage.id = booking.stage_id
        WHERE crew.person_id = $1::uuid
          AND (
            $2::uuid[] IS NULL
            OR booking.id IS NULL
            OR booking.direct_client_organization_id = ANY($2::uuid[])
          )

        UNION ALL

        SELECT
          event.id::text,
          COALESCE(event.name, listing.name),
          occurrence.id::text,
          occurrence.occurrence_year,
          occurrence.race_date::text,
          prospect.converted_booking_id::text,
          prospect.id::text,
          'prospect_primary'::text,
          NULL::text,
          stage.name,
          occurrence.race_date,
          COALESCE(event.name, listing.name)
        FROM crm.prospects prospect
        JOIN crm.pipeline_stages stage ON stage.id = prospect.stage_id
        LEFT JOIN crm.events event ON event.id = prospect.event_id
        LEFT JOIN catalog.race_listings listing
          ON listing.id = prospect.race_listing_id
        LEFT JOIN crm.event_occurrences occurrence
          ON occurrence.id = prospect.occurrence_id
        WHERE prospect.primary_contact_person_id = $1::uuid
          AND prospect.archived_at IS NULL
          AND COALESCE(event.name, listing.name) IS NOT NULL
      ) linked
      ORDER BY sort_date DESC NULLS LAST, sort_name
    `,
    [personId, assignedClientOrgIds],
  );
}

export async function addPersonOrganization(
  client: PoolClient,
  personId: string,
  organizationId: string,
) {
  await client.query(
    `
      INSERT INTO crm.person_organizations (person_id, organization_id)
      VALUES ($1::uuid, $2::uuid)
      ON CONFLICT (person_id, organization_id) DO NOTHING
    `,
    [personId, organizationId],
  );
}

