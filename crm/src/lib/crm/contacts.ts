export function uniqueIds(ids: Array<string | null | undefined>): string[] {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

export function resolvePersonDisplayName(input: {
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}) {
  const displayName = input.displayName?.trim();
  if (displayName) return displayName;
  return [input.firstName, input.lastName]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}

export function expandContactOrgScope(input: {
  assignedOrgIds: string[];
  relatedEventOwnerOrgIds: string[];
}) {
  return uniqueIds([...input.assignedOrgIds, ...input.relatedEventOwnerOrgIds]);
}

export function personIsInContactScope(input: {
  isSuperAdmin: boolean;
  personOrgIds: string[];
  scopedOrgIds: string[];
  bookingLinked: boolean;
}) {
  if (input.isSuperAdmin) return true;
  if (input.bookingLinked) return true;
  return input.personOrgIds.some((id) => input.scopedOrgIds.includes(id));
}

export function mergeVisibleOrganizationIds(input: {
  existingIds: string[];
  selectedVisibleIds: string[];
  visibleOrgIds: string[] | null;
}) {
  if (input.visibleOrgIds === null) {
    return uniqueIds(input.selectedVisibleIds);
  }
  const visible = new Set(input.visibleOrgIds);
  const hidden = input.existingIds.filter((id) => !visible.has(id));
  const nextVisible = input.selectedVisibleIds.filter((id) => visible.has(id));
  return uniqueIds([...hidden, ...nextVisible]);
}

export function resolvePrimaryOrganizationId(
  current: string | null | undefined,
  organizationIds: string[],
) {
  if (current && organizationIds.includes(current)) return current;
  return organizationIds[0] ?? null;
}

export const CONTACT_LIST_VIEWS = [
  "direct_clients",
  "event_clients",
  "crew",
  "prospects",
] as const;
export type ContactListView = (typeof CONTACT_LIST_VIEWS)[number];

const LEGACY_CONTACT_LIST_VIEWS: Record<string, ContactListView> = {
  organizations: "direct_clients",
  clients: "event_clients",
};

export const CONTACT_LIST_STATUSES = ["active", "inactive", "archived"] as const;
export type ContactListStatus = (typeof CONTACT_LIST_STATUSES)[number];

export function parseContactListStatus(
  archived?: string,
  inactive?: string,
): ContactListStatus {
  if (archived === "1") return "archived";
  if (inactive === "1") return "inactive";
  return "active";
}

export function personListStatusSql(param: number, personAlias = "person") {
  return `
    (
      ($${param}::text = 'archived' AND ${personAlias}.archived_at IS NOT NULL)
      OR (
        $${param}::text = 'inactive'
        AND ${personAlias}.archived_at IS NULL
        AND ${personAlias}.is_active = false
      )
      OR (
        $${param}::text = 'active'
        AND ${personAlias}.archived_at IS NULL
        AND ${personAlias}.is_active = true
      )
    )
  `;
}

export function parseContactListView(
  value: string | undefined,
  access: {
    canAccessOperations: boolean;
    canAccessProspecting: boolean;
  },
): ContactListView {
  const requested = value ? (LEGACY_CONTACT_LIST_VIEWS[value] ?? value) : undefined;
  if (requested === "event_clients" && access.canAccessOperations) {
    return "event_clients";
  }
  if (requested === "crew" && access.canAccessOperations) return "crew";
  if (requested === "prospects" && access.canAccessProspecting) return "prospects";
  if (requested === "direct_clients" && access.canAccessOperations) {
    return "direct_clients";
  }
  if (access.canAccessOperations) return "direct_clients";
  if (access.canAccessProspecting) return "prospects";
  return "direct_clients";
}

export function personHasOrganizationTag(input: {
  organizationId?: string | null;
  membershipOrgIds: string[];
}) {
  if (input.organizationId) return true;
  return input.membershipOrgIds.length > 0;
}

export function personIsCrewContact(input: {
  hasLiveCrewAssignment: boolean;
  contactType?: string | null;
  title?: string | null;
}) {
  if (input.hasLiveCrewAssignment) return true;
  if ((input.contactType?.trim().toLowerCase() ?? "") === "crew") return true;
  return /\bcrew\b/i.test(input.title ?? "");
}

export function personIsDirectClientContact(input: {
  taggedToDirectClientOrg: boolean;
  isCrew: boolean;
}) {
  if (input.isCrew) return false;
  return input.taggedToDirectClientOrg;
}

export function personIsEventClientContact(input: {
  isBookingPrimary: boolean;
  taggedToBookedNonDirectClientEventOwnerOrg: boolean;
}) {
  return (
    input.isBookingPrimary || input.taggedToBookedNonDirectClientEventOwnerOrg
  );
}

export function personIsProspectContact(input: {
  organizationId?: string | null;
  membershipOrgIds: string[];
  isCrew: boolean;
  isBookingPrimary: boolean;
  taggedToBookedNonDirectClientEventOwnerOrg: boolean;
  isProspectPrimary: boolean;
  hasProspectContactMethod: boolean;
}) {
  if (input.isProspectPrimary) return true;
  if (!input.hasProspectContactMethod) return false;
  if (personHasOrganizationTag(input)) return false;
  if (input.isCrew) return false;
  if (
    personIsEventClientContact({
      isBookingPrimary: input.isBookingPrimary,
      taggedToBookedNonDirectClientEventOwnerOrg:
        input.taggedToBookedNonDirectClientEventOwnerOrg,
    })
  ) {
    return false;
  }
  return true;
}

export function formatContactEventNames(names: string[], limit = 2) {
  const cleaned = names.map((name) => name.trim()).filter(Boolean);
  if (!cleaned.length) return null;
  if (cleaned.length <= limit) return cleaned.join(", ");
  return `${cleaned.slice(0, limit).join(", ")} + ${cleaned.length - limit} more`;
}

export function prospectContactHref(input: {
  prospectId?: string | null;
  personId?: string | null;
}) {
  if (input.prospectId) return `/prospecting/${input.prospectId}`;
  if (input.personId) return `/contacts/${input.personId}`;
  return null;
}

export function personInContactScopeSql(
  scopeParam: number,
  assignedParam: number,
  personAlias = "person",
) {
  return `
    (
      $${scopeParam}::uuid[] IS NULL
      OR ${personAlias}.organization_id = ANY($${scopeParam}::uuid[])
      OR EXISTS (
        SELECT 1 FROM crm.person_organizations membership
        WHERE membership.person_id = ${personAlias}.id
          AND membership.organization_id = ANY($${scopeParam}::uuid[])
      )
      OR EXISTS (
        SELECT 1 FROM crm.bookings booking
        WHERE booking.direct_client_organization_id = ANY($${assignedParam}::uuid[])
          AND booking.primary_contact_person_id = ${personAlias}.id
      )
      OR EXISTS (
        SELECT 1 FROM crm.crew_assignments crew
        JOIN crm.bookings booking ON booking.occurrence_id = crew.occurrence_id
        WHERE booking.direct_client_organization_id = ANY($${assignedParam}::uuid[])
          AND crew.person_id = ${personAlias}.id
      )
    )
  `;
}

export function personHasOrganizationTagSql(personAlias = "person") {
  return `
    (
      ${personAlias}.organization_id IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM crm.person_organizations membership
        WHERE membership.person_id = ${personAlias}.id
      )
    )
  `;
}

export function personIsCrewContactSql(personAlias = "person") {
  return `
    (
      EXISTS (
        SELECT 1 FROM crm.crew_assignments crew
        JOIN crm.bookings booking ON booking.occurrence_id = crew.occurrence_id
        WHERE crew.person_id = ${personAlias}.id
          AND booking.archived_at IS NULL
      )
      OR lower(btrim(COALESCE(${personAlias}.contact_type, ''))) = 'crew'
      OR (
        ${personAlias}.title IS NOT NULL
        AND ${personAlias}.title ~* '\\ycrew\\y'
      )
    )
  `;
}

export function personIsDirectClientContactSql(personAlias = "person") {
  return `
    (
      EXISTS (
        SELECT 1
        FROM (
          SELECT person_id, organization_id FROM crm.person_organizations
          UNION
          SELECT id, organization_id FROM crm.people
          WHERE organization_id IS NOT NULL
        ) ties
        JOIN crm.organization_roles role
          ON role.organization_id = ties.organization_id
        WHERE ties.person_id = ${personAlias}.id
          AND role.role = 'direct_client'
      )
      AND NOT ${personIsCrewContactSql(personAlias)}
    )
  `;
}

export function personIsEventClientContactSql(personAlias = "person") {
  return `
    (
      EXISTS (
        SELECT 1 FROM crm.bookings booking
        WHERE booking.primary_contact_person_id = ${personAlias}.id
          AND booking.archived_at IS NULL
      )
      OR EXISTS (
        SELECT 1
        FROM crm.bookings booking
        JOIN crm.event_occurrences occurrence
          ON occurrence.id = booking.occurrence_id
        WHERE booking.archived_at IS NULL
          AND occurrence.event_owner_organization_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM crm.organization_roles role
            WHERE role.organization_id = occurrence.event_owner_organization_id
              AND role.role = 'direct_client'
          )
          AND (
            ${personAlias}.organization_id = occurrence.event_owner_organization_id
            OR EXISTS (
              SELECT 1 FROM crm.person_organizations membership
              WHERE membership.person_id = ${personAlias}.id
                AND membership.organization_id = occurrence.event_owner_organization_id
            )
          )
      )
    )
  `;
}

export function personMatchesProspectContactSql(personAlias = "person") {
  return `
    (
      EXISTS (
        SELECT 1 FROM crm.prospects prospect
        WHERE prospect.primary_contact_person_id = ${personAlias}.id
      )
      OR (
        EXISTS (
          SELECT 1 FROM crm.contact_methods method
          WHERE (
            method.type = 'email'
            AND ${personAlias}.email IS NOT NULL
            AND btrim(${personAlias}.email) <> ''
            AND lower(method.normalized_value) = lower(btrim(${personAlias}.email))
          )
          OR (
            method.type = 'phone'
            AND ${personAlias}.phone IS NOT NULL
            AND btrim(${personAlias}.phone) <> ''
            AND regexp_replace(${personAlias}.phone, '[^0-9]', '', 'g') =
              regexp_replace(method.normalized_value, '[^0-9]', '', 'g')
            AND regexp_replace(method.normalized_value, '[^0-9]', '', 'g') <> ''
          )
        )
        AND NOT ${personHasOrganizationTagSql(personAlias)}
        AND NOT ${personIsCrewContactSql(personAlias)}
        AND NOT ${personIsEventClientContactSql(personAlias)}
      )
    )
  `;
}
