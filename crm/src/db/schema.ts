import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const catalog = pgSchema("catalog");
export const crm = pgSchema("crm");

export const catalogRaceListings = catalog.table("race_listings", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  descriptionHtml: text("description_html"),
  logoUrl: text("logo_url"),
  registrationUrl: text("registration_url"),
  externalRaceUrl: text("external_race_url"),
  street: text("street"),
  street2: text("street2"),
  city: text("city"),
  state: text("state"),
  zipcode: text("zipcode"),
  timezone: text("timezone"),
  nextStartAt: timestamp("next_start_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const catalogRaceEditions = catalog.table("race_editions", {
  id: text("id").primaryKey(),
  raceListingId: text("race_listing_id")
    .notNull()
    .references(() => catalogRaceListings.id),
  editionYear: integer("edition_year"),
  startsAt: timestamp("starts_at"),
  timezone: text("timezone"),
  isFuture: boolean("is_future").notNull(),
});

export const catalogLeadNotes = catalog.table("lead_notes", {
  raceListingId: text("race_listing_id")
    .primaryKey()
    .references(() => catalogRaceListings.id),
  body: text("body").notNull(),
  qualificationStatus: text("qualification_status"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const userRole = crm.enum("user_role", [
  "admin",
  "prospecting_user",
  "member",
]);
export const membershipOrgRole = crm.enum("membership_org_role", [
  "org_admin",
  "org_user",
]);
export const pipelineKind = crm.enum("pipeline_kind", ["prospect", "booking"]);
export const actorType = crm.enum("actor_type", ["human", "ai", "system"]);
export const activityType = crm.enum("activity_type", [
  "phone_call",
  "email",
  "meeting",
  "note",
  "stage_change",
]);
export const taskStatus = crm.enum("task_status", ["open", "complete", "canceled"]);
export const contactMethodType = crm.enum("contact_method_type", ["email", "phone"]);
export const contactMethodSource = crm.enum("contact_method_source", [
  "extracted",
  "manual",
  "ai",
  "imported",
]);
export const contactMethodStatus = crm.enum("contact_method_status", [
  "valid",
  "invalid",
  "unknown",
]);
export const contactExtractionStatus = crm.enum("contact_extraction_status", [
  "processed",
  "failed",
]);
export const organizationRole = crm.enum("organization_role", [
  "direct_client",
  "event_owner",
  "timing_company",
  "other",
]);
export const eventSourceType = crm.enum("event_source_type", [
  "runsignup",
  "race_roster",
  "manual",
  "other",
]);
export const timerLocation = crm.enum("timer_location", ["on_site", "remote"]);
export const prepItemStatus = crm.enum("prep_item_status", [
  "pending",
  "complete",
  "not_applicable",
]);
export const googleConnectionStatus = crm.enum("google_connection_status", [
  "disconnected",
  "connected",
  "syncing",
  "synced",
  "expired",
  "error",
]);
export const googleCalendarSyncStatus = crm.enum("google_calendar_sync_status", [
  "synced",
  "needs_sync",
  "error",
  "deleted",
]);
export const googleEmailDirection = crm.enum("google_email_direction", [
  "incoming",
  "outgoing",
]);

export const users = crm.table(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    authProviderId: text("auth_provider_id").notNull().unique(),
    name: text("name").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    phone: text("phone"),
    email: text("email").notNull(),
    defaultSendGoogleSub: text("default_send_google_sub"),
    defaultCalendarGoogleSub: text("default_calendar_google_sub"),
    role: userRole("role").notNull().default("prospecting_user"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("users_email_idx").on(table.email)],
);

export const pipelineStages = crm.table(
  "pipeline_stages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    pipeline: pipelineKind("pipeline").notNull(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull(),
    isTerminal: boolean("is_terminal").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("pipeline_stages_pipeline_key_uidx").on(table.pipeline, table.key),
    uniqueIndex("pipeline_stages_pipeline_sort_uidx").on(
      table.pipeline,
      table.sortOrder,
    ),
  ],
);

export const organizations = crm.table(
  "organizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    website: text("website"),
    phone: text("phone"),
    email: text("email"),
    street: text("street"),
    street2: text("street2"),
    city: text("city"),
    state: text("state"),
    zipcode: text("zipcode"),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archivedByUserId: uuid("archived_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("organizations_name_idx").on(table.name),
    index("organizations_active_idx").on(table.isActive),
  ],
);

export const userOrganizationMemberships = crm.table(
  "user_organization_memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    orgRole: membershipOrgRole("org_role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("user_organization_memberships_user_org_uidx").on(
      table.userId,
      table.organizationId,
    ),
    index("user_organization_memberships_org_idx").on(table.organizationId),
  ],
);

export const organizationRoles = crm.table(
  "organization_roles",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    role: organizationRole("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("organization_roles_org_role_uidx").on(
      table.organizationId,
      table.role,
    ),
    index("organization_roles_role_idx").on(table.role),
  ],
);

export const organizationRelationships = crm.table(
  "organization_relationships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceOrganizationId: uuid("source_organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    targetOrganizationId: uuid("target_organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    relationshipType: text("relationship_type").notNull().default("client_of"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("organization_relationships_unique_uidx").on(
      table.sourceOrganizationId,
      table.targetOrganizationId,
      table.relationshipType,
    ),
    index("organization_relationships_target_idx").on(table.targetOrganizationId),
    check(
      "organization_relationships_not_self_check",
      sql`${table.sourceOrganizationId} <> ${table.targetOrganizationId}`,
    ),
  ],
);

export const people = crm.table(
  "people",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    firstName: text("first_name"),
    lastName: text("last_name"),
    displayName: text("display_name"),
    title: text("title"),
    email: text("email"),
    phone: text("phone"),
    street: text("street"),
    street2: text("street2"),
    city: text("city"),
    state: text("state"),
    zipcode: text("zipcode"),
    notes: text("notes"),
    contactType: text("contact_type"),
    doNotContact: boolean("do_not_contact").notNull().default(false),
    emailOptOut: boolean("email_opt_out").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archivedByUserId: uuid("archived_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("people_organization_idx").on(table.organizationId),
    index("people_display_name_idx").on(table.displayName),
  ],
);

export const personOrganizations = crm.table(
  "person_organizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("person_organizations_person_org_uidx").on(
      table.personId,
      table.organizationId,
    ),
    index("person_organizations_org_idx").on(table.organizationId),
  ],
);

export const events = crm.table(
  "events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    catalogRaceListingId: text("catalog_race_listing_id").references(
      () => catalogRaceListings.id,
    ),
    sourceType: eventSourceType("source_type").notNull().default("manual"),
    externalSourceId: text("external_source_id"),
    defaultOwnerOrganizationId: uuid("default_owner_organization_id").references(
      () => organizations.id,
      { onDelete: "set null" },
    ),
    website: text("website"),
    notes: text("notes"),
    catalogMatchDismissedAt: timestamp("catalog_match_dismissed_at", {
      withTimezone: true,
    }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archivedByUserId: uuid("archived_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("events_catalog_listing_idx").on(table.catalogRaceListingId),
    index("events_name_idx").on(table.name),
  ],
);

export const eventOccurrences = crm.table(
  "event_occurrences",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    catalogRaceEditionId: text("catalog_race_edition_id").references(
      () => catalogRaceEditions.id,
    ),
    occurrenceYear: integer("occurrence_year"),
    raceDate: timestamp("race_date", { withTimezone: true }),
    timezone: text("timezone"),
    eventOwnerOrganizationId: uuid("event_owner_organization_id").references(
      () => organizations.id,
      { onDelete: "set null" },
    ),
    registrationPlatform: text("registration_platform"),
    registrationUrlOverride: text("registration_url_override"),
    streetOverride: text("street_override"),
    street2Override: text("street2_override"),
    cityOverride: text("city_override"),
    stateOverride: text("state_override"),
    zipcodeOverride: text("zipcode_override"),
    timerLocation: timerLocation("timer_location"),
    hardwareEventName: text("hardware_event_name"),
    scoringExpectations: text("scoring_expectations"),
    postEventExpectations: text("post_event_expectations"),
    notes: text("notes"),
    calculatedArrivalAt: timestamp("calculated_arrival_at", { withTimezone: true }),
    arrivalOverrideAt: timestamp("arrival_override_at", { withTimezone: true }),
    calculatedDepartureAt: timestamp("calculated_departure_at", {
      withTimezone: true,
    }),
    departureOverrideAt: timestamp("departure_override_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("event_occurrences_catalog_edition_idx").on(
      table.catalogRaceEditionId,
    ),
    index("event_occurrences_event_year_idx").on(
      table.eventId,
      table.occurrenceYear,
    ),
    index("event_occurrences_race_date_idx").on(table.raceDate),
  ],
);

export const occurrenceRaces = crm.table(
  "occurrence_races",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    occurrenceId: uuid("occurrence_id")
      .notNull()
      .references(() => eventOccurrences.id, { onDelete: "cascade" }),
    catalogRaceOfferingId: text("catalog_race_offering_id"),
    name: text("name").notNull(),
    distanceLabel: text("distance_label"),
    distanceMiles: numeric("distance_miles", { precision: 8, scale: 3 }),
    distanceMeters: integer("distance_meters"),
    startTime: timestamp("start_time"),
    ageGroups: text("age_groups"),
    awards: text("awards"),
    scoring: jsonb("scoring").notNull().default({}),
    estimatedDurationMinutes: integer("estimated_duration_minutes"),
    durationOverrideMinutes: integer("duration_override_minutes"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("occurrence_races_occurrence_sort_idx").on(
      table.occurrenceId,
      table.sortOrder,
    ),
    check(
      "occurrence_races_duration_positive_check",
      sql`(${table.estimatedDurationMinutes} IS NULL OR ${table.estimatedDurationMinutes} > 0)
        AND (${table.durationOverrideMinutes} IS NULL OR ${table.durationOverrideMinutes} > 0)`,
    ),
  ],
);

export const coursePoints = crm.table(
  "course_points",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    occurrenceId: uuid("occurrence_id")
      .notNull()
      .references(() => eventOccurrences.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    hardwarePointName: text("hardware_point_name"),
    notes: text("notes"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("course_points_occurrence_sort_idx").on(
      table.occurrenceId,
      table.sortOrder,
    ),
  ],
);

export const crewAssignments = crm.table(
  "crew_assignments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    occurrenceId: uuid("occurrence_id")
      .notNull()
      .references(() => eventOccurrences.id, { onDelete: "cascade" }),
    personId: uuid("person_id").references(() => people.id, {
      onDelete: "set null",
    }),
    freeformName: text("freeform_name"),
    role: text("role"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("crew_assignments_occurrence_idx").on(table.occurrenceId),
    check(
      "crew_assignments_name_check",
      sql`${table.personId} IS NOT NULL OR NULLIF(trim(${table.freeformName}), '') IS NOT NULL`,
    ),
  ],
);

export const bookings = crm.table(
  "bookings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    occurrenceId: uuid("occurrence_id")
      .notNull()
      .references(() => eventOccurrences.id),
    directClientOrganizationId: uuid("direct_client_organization_id")
      .notNull()
      .references(() => organizations.id),
    primaryContactPersonId: uuid("primary_contact_person_id").references(
      () => people.id,
      { onDelete: "set null" },
    ),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => pipelineStages.id),
    assignedUserId: uuid("assigned_user_id").references(() => users.id),
    expectedRevenue: numeric("expected_revenue", { precision: 12, scale: 2 }),
    actualRevenue: numeric("actual_revenue", { precision: 12, scale: 2 }),
    amountPaid: numeric("amount_paid", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    paymentDueAt: timestamp("payment_due_at", { withTimezone: true }),
    paymentAt: timestamp("payment_at", { withTimezone: true }),
    notes: text("notes"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archivedByUserId: uuid("archived_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("bookings_occurrence_uidx").on(table.occurrenceId),
    index("bookings_stage_idx").on(table.stageId),
    index("bookings_client_idx").on(table.directClientOrganizationId),
    index("bookings_completed_idx").on(table.completedAt),
  ],
);

export const externalRecords = crm.table(
  "external_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    source: text("source").notNull(),
    entityType: text("entity_type").notNull(),
    externalId: text("external_id").notNull(),
    localId: uuid("local_id").notNull(),
    rawData: jsonb("raw_data").notNull().default({}),
    importedAt: timestamp("imported_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("external_records_source_type_id_uidx").on(
      table.source,
      table.entityType,
      table.externalId,
    ),
    index("external_records_local_idx").on(table.entityType, table.localId),
  ],
);

export const bookingPrepItems = crm.table(
  "booking_prep_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    notes: text("notes"),
    status: prepItemStatus("status").notNull().default("pending"),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("booking_prep_items_booking_key_uidx").on(
      table.bookingId,
      table.key,
    ),
    index("booking_prep_items_booking_status_idx").on(
      table.bookingId,
      table.status,
    ),
  ],
);

export const prospects = crm.table(
  "prospects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    raceListingId: text("race_listing_id")
      .references(() => catalogRaceListings.id),
    raceEditionId: text("race_edition_id").references(() => catalogRaceEditions.id),
    eventId: uuid("event_id").references(() => events.id),
    occurrenceId: uuid("occurrence_id").references(() => eventOccurrences.id),
    primaryContactPersonId: uuid("primary_contact_person_id").references(
      () => people.id,
      { onDelete: "set null" },
    ),
    assignedUserId: uuid("assigned_user_id").references(() => users.id),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => pipelineStages.id),
    doNotContact: boolean("do_not_contact").notNull().default(false),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    convertedBookingId: uuid("converted_booking_id").references(() => bookings.id, {
      onDelete: "set null",
    }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archivedByUserId: uuid("archived_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    lastStepNote: text("last_step_note"),
    nextStepOn: date("next_step_on"),
    nextStepNote: text("next_step_note"),
    closedLostReason: text("closed_lost_reason"),
    closedLostNote: text("closed_lost_note"),
    circleBackOn: date("circle_back_on"),
    unqualifiedReason: text("unqualified_reason"),
    unqualifiedNote: text("unqualified_note"),
    disqualifiedReason: text("disqualified_reason"),
    disqualifiedNote: text("disqualified_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("prospects_source_uidx").on(
      table.raceListingId,
      sql`coalesce(${table.raceEditionId}, '')`,
    ),
    index("prospects_stage_idx").on(table.stageId),
    index("prospects_assignee_idx").on(table.assignedUserId),
    index("prospects_created_at_idx").on(table.createdAt),
    uniqueIndex("prospects_occurrence_uidx").on(table.occurrenceId),
    check(
      "prospects_source_check",
      sql`${table.raceListingId} IS NOT NULL OR ${table.eventId} IS NOT NULL`,
    ),
    check(
      "prospects_closed_lost_reason_check",
      sql`${table.closedLostReason} IS NULL OR ${table.closedLostReason} IN (
        'went_with_another_timer',
        'event_cancelled',
        'no_decision',
        'other'
      )`,
    ),
    check(
      "prospects_unqualified_reason_check",
      sql`${table.unqualifiedReason} IS NULL OR ${table.unqualifiedReason} IN (
        'event_too_soon',
        'other'
      )`,
    ),
    check(
      "prospects_disqualified_reason_check",
      sql`${table.disqualifiedReason} IS NULL OR ${table.disqualifiedReason} IN (
        'is_a_timing_company',
        'blacklisted_email',
        'other'
      )`,
    ),
  ],
);

export const contactMethods = crm.table(
  "contact_methods",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    prospectId: uuid("prospect_id")
      .references(() => prospects.id, { onDelete: "set null" }),
    raceListingId: text("race_listing_id").references(() => catalogRaceListings.id),
    type: contactMethodType("type").notNull(),
    rawValue: text("raw_value").notNull(),
    normalizedValue: text("normalized_value").notNull(),
    label: text("label"),
    source: contactMethodSource("source").notNull(),
    sourceField: text("source_field"),
    sourceContentHash: text("source_content_hash"),
    isPrimary: boolean("is_primary").notNull().default(false),
    status: contactMethodStatus("status").notNull().default("unknown"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("contact_methods_listing_type_value_uidx").on(
      table.raceListingId,
      table.type,
      table.normalizedValue,
    ),
    uniqueIndex("contact_methods_prospect_type_value_uidx").on(
      table.prospectId,
      table.type,
      table.normalizedValue,
    ),
    index("contact_methods_listing_primary_idx").on(
      table.raceListingId,
      table.isPrimary,
    ),
    index("contact_methods_prospect_idx").on(table.prospectId),
    check(
      "contact_methods_source_check",
      sql`${table.raceListingId} IS NOT NULL OR ${table.prospectId} IS NOT NULL`,
    ),
  ],
);

export const contactExtractionState = crm.table(
  "contact_extraction_state",
  {
    raceListingId: text("race_listing_id")
      .primaryKey()
      .references(() => catalogRaceListings.id, { onDelete: "cascade" }),
    sourceContentHash: text("source_content_hash").notNull(),
    parserVersion: text("parser_version").notNull(),
    status: contactExtractionStatus("status").notNull(),
    extractedCount: integer("extracted_count").notNull().default(0),
    errorMessage: text("error_message"),
    processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("contact_extraction_state_updated_idx").on(table.updatedAt)],
);

export const prospectEmailBlacklist = crm.table(
  "prospect_email_blacklist",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    pattern: text("pattern").notNull(),
    matchKind: text("match_kind").notNull(),
    reason: text("reason").notNull(),
    note: text("note"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("prospect_email_blacklist_pattern_uidx").on(table.pattern),
    check(
      "prospect_email_blacklist_match_kind_check",
      sql`${table.matchKind} IN ('email', 'domain')`,
    ),
    check(
      "prospect_email_blacklist_reason_check",
      sql`${table.reason} IN (
        'is_a_timing_company',
        'blacklisted_email',
        'other'
      )`,
    ),
  ],
);

export const emailDrafts = crm.table(
  "email_drafts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    prospectId: uuid("prospect_id")
      .notNull()
      .references(() => prospects.id, { onDelete: "cascade" }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    gmailThreadId: text("gmail_thread_id"),
    inReplyToRfcMessageId: text("in_reply_to_rfc_message_id"),
    replyToGmailMessageId: text("reply_to_gmail_message_id"),
    toAddresses: text("to_addresses").array().notNull().default([]),
    ccAddresses: text("cc_addresses").array().notNull().default([]),
    subject: text("subject").notNull().default(""),
    bodyText: text("body_text").notNull().default(""),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    sentGmailMessageId: text("sent_gmail_message_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("email_drafts_prospect_idx").on(table.prospectId),
    index("email_drafts_author_idx").on(table.createdByUserId),
  ],
);

export const emailTemplates = crm.table(
  "email_templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    subject: text("subject").notNull().default(""),
    bodyHtml: text("body_html").notNull().default(""),
    kind: text("kind").notNull().default("crew"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("email_templates_user_name_uidx").on(table.userId, table.name),
    index("email_templates_user_idx").on(table.userId),
  ],
);

export const activities = crm.table(
  "activities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    prospectId: uuid("prospect_id")
      .references(() => prospects.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id").references(() => bookings.id, {
      onDelete: "cascade",
    }),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    type: activityType("type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    body: text("body").notNull(),
    disposition: text("disposition"),
    actorType: actorType("actor_type").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    actorName: text("actor_name").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("activities_prospect_occurred_idx").on(
      table.prospectId,
      table.occurredAt,
    ),
    index("activities_booking_occurred_idx").on(table.bookingId, table.occurredAt),
    index("activities_organization_occurred_idx").on(
      table.organizationId,
      table.occurredAt,
    ),
    check(
      "activities_related_record_check",
      sql`${table.prospectId} IS NOT NULL OR ${table.bookingId} IS NOT NULL OR ${table.organizationId} IS NOT NULL`,
    ),
    check(
      "activities_human_actor_check",
      sql`${table.actorType} <> 'human' OR ${table.actorUserId} IS NOT NULL`,
    ),
  ],
);

export const tasks = crm.table(
  "tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    prospectId: uuid("prospect_id")
      .references(() => prospects.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id").references(() => bookings.id, {
      onDelete: "cascade",
    }),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    sourceActivityId: uuid("source_activity_id").references(() => activities.id),
    assignedUserId: uuid("assigned_user_id")
      .notNull()
      .references(() => users.id),
    title: text("title").notNull(),
    notes: text("notes"),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    status: taskStatus("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("tasks_assignee_status_due_idx").on(
      table.assignedUserId,
      table.status,
      table.dueAt,
    ),
    index("tasks_prospect_status_due_idx").on(
      table.prospectId,
      table.status,
      table.dueAt,
    ),
    index("tasks_booking_status_due_idx").on(
      table.bookingId,
      table.status,
      table.dueAt,
    ),
    check(
      "tasks_related_record_check",
      sql`${table.prospectId} IS NOT NULL OR ${table.bookingId} IS NOT NULL OR ${table.organizationId} IS NOT NULL`,
    ),
    check(
      "tasks_completed_at_check",
      sql`${table.status} <> 'complete' OR ${table.completedAt} IS NOT NULL`,
    ),
  ],
);

export const googleConnections = crm.table("google_connections", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  googleSub: text("google_sub").notNull(),
  googleEmail: text("google_email").notNull(),
  gmailHistoryId: text("gmail_history_id"),
  gmailLastSyncedAt: timestamp("gmail_last_synced_at", { withTimezone: true }),
  gmailBackfillCompletedAt: timestamp("gmail_backfill_completed_at", {
    withTimezone: true,
  }),
  gmailStatus: googleConnectionStatus("gmail_status")
    .notNull()
    .default("disconnected"),
  gmailLastError: text("gmail_last_error"),
  calendarId: text("calendar_id"),
  calendarSummary: text("calendar_summary"),
  calendarStatus: googleConnectionStatus("calendar_status")
    .notNull()
    .default("disconnected"),
  calendarLastError: text("calendar_last_error"),
  calendarLastSyncedAt: timestamp("calendar_last_synced_at", {
    withTimezone: true,
  }),
  googleRefreshTokenCiphertext: text("google_refresh_token_ciphertext"),
  googleAccessTokenCiphertext: text("google_access_token_ciphertext"),
  googleAccessTokenExpiresAt: timestamp("google_access_token_expires_at", {
    withTimezone: true,
  }),
  googleGrantedScopes: text("google_granted_scopes"),
  connectedAt: timestamp("connected_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  uniqueIndex("google_connections_google_sub_uidx").on(table.googleSub),
  uniqueIndex("google_connections_user_google_sub_uidx").on(table.userId, table.googleSub),
]);

export const googleEmailMessages = crm.table(
  "google_email_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    googleSub: text("google_sub").notNull(),
    googleEmail: text("google_email").notNull(),
    gmailMessageId: text("gmail_message_id").notNull(),
    gmailThreadId: text("gmail_thread_id"),
    rfcMessageId: text("rfc_message_id"),
    direction: googleEmailDirection("direction").notNull(),
    fromAddress: text("from_address"),
    fromName: text("from_name"),
    toAddresses: text("to_addresses").array().notNull().default([]),
    ccAddresses: text("cc_addresses").array().notNull().default([]),
    subject: text("subject"),
    snippet: text("snippet"),
    bodyText: text("body_text"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("google_email_messages_account_id_uidx").on(
      table.googleSub,
      table.gmailMessageId,
    ),
    index("google_email_messages_occurred_idx").on(table.occurredAt),
  ],
);

export const googleEmailLinks = crm.table(
  "google_email_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => googleEmailMessages.id, { onDelete: "cascade" }),
    prospectId: uuid("prospect_id").references(() => prospects.id, {
      onDelete: "cascade",
    }),
    bookingId: uuid("booking_id").references(() => bookings.id, {
      onDelete: "cascade",
    }),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    personId: uuid("person_id").references(() => people.id, {
      onDelete: "set null",
    }),
    activityId: uuid("activity_id").references(() => activities.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("google_email_links_message_prospect_uidx").on(
      table.messageId,
      table.prospectId,
    ),
    uniqueIndex("google_email_links_message_booking_uidx").on(
      table.messageId,
      table.bookingId,
    ),
    uniqueIndex("google_email_links_message_organization_uidx").on(
      table.messageId,
      table.organizationId,
    ),
    uniqueIndex("google_email_links_message_person_uidx").on(
      table.messageId,
      table.personId,
    ),
    index("google_email_links_activity_idx").on(table.activityId),
    check(
      "google_email_links_record_check",
      sql`${table.prospectId} IS NOT NULL OR ${table.bookingId} IS NOT NULL OR ${table.organizationId} IS NOT NULL OR ${table.personId} IS NOT NULL`,
    ),
  ],
);

export const googleCalendarLinks = crm.table(
  "google_calendar_links",
  {
    bookingId: uuid("booking_id")
      .primaryKey()
      .references(() => bookings.id, { onDelete: "cascade" }),
    googleSub: text("google_sub").notNull(),
    googleEmail: text("google_email").notNull(),
    googleCalendarId: text("google_calendar_id").notNull(),
    googleEventId: text("google_event_id").notNull(),
    htmlLink: text("html_link"),
    syncStatus: googleCalendarSyncStatus("sync_status").notNull().default("synced"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastError: text("last_error"),
    linkedAt: timestamp("linked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("google_calendar_links_event_uidx").on(
      table.googleCalendarId,
      table.googleEventId,
    ),
    index("google_calendar_links_status_idx").on(table.syncStatus),
  ],
);

export const googleTaskCalendarLinks = crm.table(
  "google_task_calendar_links",
  {
    taskId: uuid("task_id")
      .primaryKey()
      .references(() => tasks.id, { onDelete: "cascade" }),
    googleSub: text("google_sub").notNull(),
    googleEmail: text("google_email").notNull(),
    googleCalendarId: text("google_calendar_id").notNull(),
    googleEventId: text("google_event_id").notNull(),
    htmlLink: text("html_link"),
    syncStatus: googleCalendarSyncStatus("sync_status").notNull().default("synced"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastError: text("last_error"),
    linkedAt: timestamp("linked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("google_task_calendar_links_event_uidx").on(
      table.googleCalendarId,
      table.googleEventId,
    ),
    index("google_task_calendar_links_status_idx").on(table.syncStatus),
  ],
);

export type CrmUser = typeof users.$inferSelect;
export type UserOrganizationMembership =
  typeof userOrganizationMemberships.$inferSelect;
export type Organization = typeof organizations.$inferSelect;
export type Person = typeof people.$inferSelect;
export type PersonOrganization = typeof personOrganizations.$inferSelect;
export type CrmEvent = typeof events.$inferSelect;
export type EventOccurrence = typeof eventOccurrences.$inferSelect;
export type OccurrenceRace = typeof occurrenceRaces.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type Prospect = typeof prospects.$inferSelect;
export type EmailDraft = typeof emailDrafts.$inferSelect;
export type Activity = typeof activities.$inferSelect;
export type Task = typeof tasks.$inferSelect;
