import { describe, expect, it } from "vitest";
import {
  contactAssociatedEventHref,
  contactAssociationLabel,
  expandContactOrgScope,
  formatContactEventDate,
  formatContactEventNames,
  mergeVisibleOrganizationIds,
  parseContactListStatus,
  formatPersonFirstLastName,
  leadContactIdentity,
  parseContactListView,
  personIsCrewContact,
  personIsCrewContactSql,
  personIsDirectClientContact,
  personIsDirectClientContactSql,
  personIsEventClientContact,
  personIsEventClientContactSql,
  personIsInContactScope,
  personIsProspectContact,
  prospectContactHref,
  resolvePersonDisplayName,
  resolvePrimaryOrganizationId,
} from "./contacts";

const orgA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const orgB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const orgC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("contact organization memberships", () => {
  it("composes a display name from first and last when needed", () => {
    expect(
      resolvePersonDisplayName({
        firstName: "Seth",
        lastName: "Doe",
      }),
    ).toBe("Seth Doe");
    expect(
      resolvePersonDisplayName({
        displayName: "  Lead Timer  ",
        firstName: "Seth",
        lastName: "Doe",
      }),
    ).toBe("Lead Timer");
  });

  it("prefers first and last on the prospect contact line", () => {
    expect(
      formatPersonFirstLastName({
        displayName: "Lead Timer",
        firstName: "Chantal",
        lastName: "Butler",
      }),
    ).toBe("Chantal Butler");
    expect(
      leadContactIdentity({
        person: {
          firstName: "Chantal",
          lastName: "Butler",
          displayName: "Chantal Butler",
          email: "chantalbutler@enlightenedfl.com",
          phone: null,
        },
        phone: "813-555-0100",
      }),
    ).toEqual({
      name: "Chantal Butler",
      email: "chantalbutler@enlightenedfl.com",
      phone: "813-555-0100",
    });
  });

  it("expands assigned client orgs with related event-owner orgs", () => {
    expect(
      expandContactOrgScope({
        assignedOrgIds: [orgA],
        relatedEventOwnerOrgIds: [orgB, orgA],
      }),
    ).toEqual([orgA, orgB]);
  });

  it("lets super admins see every contact", () => {
    expect(
      personIsInContactScope({
        isSuperAdmin: true,
        personOrgIds: [],
        scopedOrgIds: [],
        bookingLinked: false,
      }),
    ).toBe(true);
  });

  it("shows org members contacts tied to in-scope orgs or their bookings", () => {
    expect(
      personIsInContactScope({
        isSuperAdmin: false,
        personOrgIds: [orgB],
        scopedOrgIds: [orgA, orgB],
        bookingLinked: false,
      }),
    ).toBe(true);
    expect(
      personIsInContactScope({
        isSuperAdmin: false,
        personOrgIds: [orgC],
        scopedOrgIds: [orgA],
        bookingLinked: true,
      }),
    ).toBe(true);
    expect(
      personIsInContactScope({
        isSuperAdmin: false,
        personOrgIds: [orgC],
        scopedOrgIds: [orgA],
        bookingLinked: false,
      }),
    ).toBe(false);
  });

  it("keeps hidden org ties when an org member edits visible memberships", () => {
    expect(
      mergeVisibleOrganizationIds({
        existingIds: [orgA, orgC],
        selectedVisibleIds: [orgB],
        visibleOrgIds: [orgA, orgB],
      }),
    ).toEqual([orgC, orgB]);
    expect(
      mergeVisibleOrganizationIds({
        existingIds: [orgA, orgC],
        selectedVisibleIds: [orgA, orgB],
        visibleOrgIds: null,
      }),
    ).toEqual([orgA, orgB]);
  });

  it("keeps the current primary org when it remains attached", () => {
    expect(resolvePrimaryOrganizationId(orgB, [orgA, orgB])).toBe(orgB);
    expect(resolvePrimaryOrganizationId(orgC, [orgA, orgB])).toBe(orgA);
    expect(resolvePrimaryOrganizationId(orgA, [])).toBeNull();
  });
});

describe("contact list views", () => {
  const admin = { canAccessOperations: true, canAccessProspecting: true };
  const orgMember = { canAccessOperations: true, canAccessProspecting: true };
  const prospectingOnly = {
    canAccessOperations: false,
    canAccessProspecting: true,
  };
  const operationsOnly = {
    canAccessOperations: true,
    canAccessProspecting: false,
  };

  it("defaults to direct clients when the viewer can open operations", () => {
    expect(parseContactListView(undefined, admin)).toBe("direct_clients");
    expect(parseContactListView("direct_clients", orgMember)).toBe("direct_clients");
    expect(parseContactListView("organizations", orgMember)).toBe("direct_clients");
    expect(parseContactListView("prospects", operationsOnly)).toBe("direct_clients");
    expect(parseContactListView("event_clients", prospectingOnly)).toBe("prospects");
  });

  it("uses event clients and crew when requested by operations viewers", () => {
    expect(parseContactListView("event_clients", admin)).toBe("event_clients");
    expect(parseContactListView("clients", orgMember)).toBe("event_clients");
    expect(parseContactListView("crew", operationsOnly)).toBe("crew");
    expect(parseContactListView("crew", prospectingOnly)).toBe("prospects");
  });

  it("uses prospects when requested by someone who can open prospecting", () => {
    expect(parseContactListView("prospects", admin)).toBe("prospects");
    expect(parseContactListView("prospects", orgMember)).toBe("prospects");
    expect(parseContactListView(undefined, prospectingOnly)).toBe("prospects");
    expect(parseContactListView("organizations", prospectingOnly)).toBe("prospects");
  });

  it("keeps only tagged direct-client org people in Direct clients", () => {
    expect(
      personIsDirectClientContact({
        taggedToDirectClientOrg: true,
        isCrew: false,
      }),
    ).toBe(true);
    expect(
      personIsDirectClientContact({
        taggedToDirectClientOrg: true,
        isCrew: true,
      }),
    ).toBe(false);
    expect(
      personIsDirectClientContact({
        taggedToDirectClientOrg: false,
        isCrew: false,
      }),
    ).toBe(false);
  });

  it("excludes Bigin race orgs like Fire Island from Direct clients", () => {
    expect(
      personIsDirectClientContact({
        taggedToDirectClientOrg: false,
        isCrew: false,
      }),
    ).toBe(false);
    expect(
      personIsEventClientContact({
        isBookingPrimary: false,
        taggedToBookedNonDirectClientEventOwnerOrg: false,
      }),
    ).toBe(false);
  });

  it("treats booking primaries as event clients even when their org is not a direct client", () => {
    expect(
      personIsEventClientContact({
        isBookingPrimary: true,
        taggedToBookedNonDirectClientEventOwnerOrg: false,
      }),
    ).toBe(true);
    expect(
      personIsEventClientContact({
        isBookingPrimary: false,
        taggedToBookedNonDirectClientEventOwnerOrg: true,
      }),
    ).toBe(true);
    expect(
      personIsEventClientContact({
        isBookingPrimary: false,
        taggedToBookedNonDirectClientEventOwnerOrg: false,
      }),
    ).toBe(false);
  });

  it("does not treat unbooked race-org tags as event clients", () => {
    expect(
      personIsEventClientContact({
        isBookingPrimary: false,
        taggedToBookedNonDirectClientEventOwnerOrg: false,
      }),
    ).toBe(false);
  });

  it("limits Crew to live assignments or crew title/type", () => {
    expect(
      personIsCrewContact({
        hasLiveCrewAssignment: true,
        contactType: "Partner",
        title: "Owner",
      }),
    ).toBe(true);
    expect(
      personIsCrewContact({
        hasLiveCrewAssignment: false,
        contactType: "Crew",
        title: "Race Support",
      }),
    ).toBe(true);
    expect(
      personIsCrewContact({
        hasLiveCrewAssignment: false,
        contactType: "Partner",
        title: "Crew lead",
      }),
    ).toBe(true);
    expect(
      personIsCrewContact({
        hasLiveCrewAssignment: false,
        contactType: "Partner",
        title: "Owner",
      }),
    ).toBe(false);
  });

  it("isolates prospect primaries and leftover listing emails in prospects", () => {
    expect(
      personIsProspectContact({
        organizationId: null,
        membershipOrgIds: [],
        isCrew: false,
        isBookingPrimary: false,
        taggedToBookedNonDirectClientEventOwnerOrg: false,
        isProspectPrimary: true,
        hasProspectContactMethod: true,
      }),
    ).toBe(true);
    expect(
      personIsProspectContact({
        organizationId: null,
        membershipOrgIds: [],
        isCrew: false,
        isBookingPrimary: false,
        taggedToBookedNonDirectClientEventOwnerOrg: false,
        isProspectPrimary: false,
        hasProspectContactMethod: true,
      }),
    ).toBe(true);
    expect(
      personIsProspectContact({
        organizationId: orgA,
        membershipOrgIds: [],
        isCrew: false,
        isBookingPrimary: false,
        taggedToBookedNonDirectClientEventOwnerOrg: false,
        isProspectPrimary: false,
        hasProspectContactMethod: true,
      }),
    ).toBe(false);
  });

  it("still lists race directors who are also prospect primaries", () => {
    expect(
      personIsProspectContact({
        organizationId: orgA,
        membershipOrgIds: [orgA],
        isCrew: false,
        isBookingPrimary: true,
        taggedToBookedNonDirectClientEventOwnerOrg: false,
        isProspectPrimary: true,
        hasProspectContactMethod: true,
      }),
    ).toBe(true);
  });

  it("compacts booked event names for the event clients table", () => {
    expect(formatContactEventNames(["T2T Chicago Tower Climb"])).toBe(
      "T2T Chicago Tower Climb",
    );
    expect(
      formatContactEventNames(["AAO 5K", "Heart Health 5K", "Kissimmee 5K"]),
    ).toBe("AAO 5K, Heart Health 5K + 1 more");
  });

  it("labels contact-event associations", () => {
    expect(contactAssociationLabel("booking_primary")).toBe("Primary contact");
    expect(contactAssociationLabel("prospect_primary")).toBe("Prospect contact");
    expect(contactAssociationLabel("crew")).toBe("Crew");
    expect(contactAssociationLabel("crew", "Lead timer")).toBe("Lead timer");
  });

  it("routes contact-event rows to the matching record", () => {
    const eventId = "11111111-1111-4111-8111-111111111111";
    const bookingId = "22222222-2222-4222-8222-222222222222";
    const prospectId = "33333333-3333-4333-8333-333333333333";
    expect(
      contactAssociatedEventHref({
        association: "booking_primary",
        bookingId,
        eventId,
        canAccessProspecting: true,
      }),
    ).toBe(`/bookings/${bookingId}`);
    expect(
      contactAssociatedEventHref({
        association: "crew",
        eventId,
        canAccessProspecting: false,
      }),
    ).toBe(`/events/${eventId}`);
    expect(
      contactAssociatedEventHref({
        association: "prospect_primary",
        prospectId,
        eventId,
        canAccessProspecting: true,
      }),
    ).toBe(`/prospecting/${prospectId}`);
    expect(
      contactAssociatedEventHref({
        association: "prospect_primary",
        prospectId,
        eventId,
        canAccessProspecting: false,
      }),
    ).toBe(`/events/${eventId}`);
  });

  it("formats contact event dates in Eastern time", () => {
    expect(formatContactEventDate(null)).toBe("Date TBD");
    expect(formatContactEventDate("2026-12-05T05:00:00.000Z")).toBe(
      "Dec 5, 2026",
    );
  });

  it("prefers a prospect page for imported listing contacts", () => {
    expect(prospectContactHref({ prospectId: orgA })).toBe(`/prospecting/${orgA}`);
    expect(prospectContactHref({ personId: orgB })).toBe(`/contacts/${orgB}`);
    expect(prospectContactHref({})).toBeNull();
  });

  it("maps contact list status chips", () => {
    expect(parseContactListStatus()).toBe("active");
    expect(parseContactListStatus(undefined, "1")).toBe("inactive");
    expect(parseContactListStatus("1", "1")).toBe("archived");
  });

  it("encodes Direct clients, Event clients, and Crew in SQL filters", () => {
    expect(personIsDirectClientContactSql()).toContain("role = 'direct_client'");
    expect(personIsDirectClientContactSql()).toContain("AND NOT");
    expect(personIsEventClientContactSql()).toContain(
      "primary_contact_person_id",
    );
    expect(personIsEventClientContactSql()).toContain("archived_at IS NULL");
    expect(personIsCrewContactSql()).toContain("crew_assignments");
    expect(personIsCrewContactSql()).toContain("= 'crew'");
  });
});
