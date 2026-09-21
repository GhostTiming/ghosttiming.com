import { matchesPersonNameQuery } from "./person-search";

export function personIsTaggedToOrganization(input: {
  organizationId?: string | null;
  membershipOrgIds?: readonly string[];
  clientOrganizationId: string;
}) {
  if (input.organizationId === input.clientOrganizationId) return true;
  return (input.membershipOrgIds ?? []).includes(input.clientOrganizationId);
}

export function personIsActiveCrewEligible(input: {
  isActive: boolean;
  archivedAt?: string | Date | null;
}) {
  return input.isActive && !input.archivedAt;
}

export function personIsCrewCandidate(input: {
  isActive: boolean;
  archivedAt?: string | Date | null;
  organizationId?: string | null;
  membershipOrgIds?: readonly string[];
  clientOrganizationId: string;
  wasCrewForClientOrg?: boolean;
}) {
  if (!personIsActiveCrewEligible(input)) return false;
  if (
    !personIsTaggedToOrganization({
      organizationId: input.organizationId,
      membershipOrgIds: input.membershipOrgIds,
      clientOrganizationId: input.clientOrganizationId,
    })
  ) {
    return false;
  }
  return true;
}

function matchesQuery(value: string | null | undefined, query: string) {
  return (value ?? "").toLowerCase().includes(query);
}

export function matchesCrewSearchQuery(
  person: {
    displayName?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
    organizationName?: string | null;
  },
  query: string,
  organizationName?: string | null,
) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return false;
  return (
    matchesPersonNameQuery(person, normalized) ||
    matchesQuery(person.organizationName ?? organizationName, normalized)
  );
}

export function filterCrewSearchResults<
  T extends {
    id: string;
    displayName?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
    organizationName?: string | null;
  },
>(
  people: readonly T[],
  query: string,
  options: {
    assignedPersonIds?: Iterable<string>;
    organizationName?: string | null;
  } = {},
) {
  const assigned = new Set(options.assignedPersonIds ?? []);
  return people.filter((person) => {
    if (assigned.has(person.id)) return false;
    return matchesCrewSearchQuery(person, query, options.organizationName);
  });
}

export function personTaggedToClientOrgSql(
  clientOrgExpr: string,
  personAlias = "person",
) {
  return `
    (
      ${personAlias}.organization_id = ${clientOrgExpr}
      OR EXISTS (
        SELECT 1 FROM crm.person_organizations membership
        WHERE membership.person_id = ${personAlias}.id
          AND membership.organization_id = ${clientOrgExpr}
      )
    )
  `;
}
