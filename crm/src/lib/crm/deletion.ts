export type OrganizationDependencyCounts = {
  bookings: number;
  occurrences: number;
  events: number;
  linked_people: number;
};

export function organizationDeletionBlockers(
  counts: OrganizationDependencyCounts,
) {
  return [
    counts.bookings && `${counts.bookings} booking(s)`,
    counts.occurrences && `${counts.occurrences} event occurrence(s)`,
    counts.events && `${counts.events} owned event(s)`,
    counts.linked_people && `${counts.linked_people} linked contact(s)`,
  ].filter((value): value is string => Boolean(value));
}

