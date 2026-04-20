import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const events = pgTable(
  "events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shortId: text("short_id").notNull().unique(),
    name: text("name").notNull().default("Untitled event"),
    gateTime: text("gate_time"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    ingestTokenHash: text("ingest_token_hash").notNull(),
    viewerPasswordHash: text("viewer_password_hash").notNull(),
    lastIngestAt: timestamp("last_ingest_at", { withTimezone: true }),
  },
  (t) => ({
    shortIdx: index("events_short_id_idx").on(t.shortId),
  }),
);

export const macsEvent = pgTable(
  "macs_event",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    mac: text("mac").notNull(),
    friendlyName: text("friendly_name"),
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
    totalReads: bigint("total_reads", { mode: "number" }).notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.eventId, t.mac] }),
    macSeenIdx: index("macs_event_last_seen_idx").on(t.eventId, t.lastSeen),
  }),
);

export const portsEvent = pgTable(
  "ports_event",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    mac: text("mac").notNull(),
    port: integer("port").notNull(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
    totalReads: bigint("total_reads", { mode: "number" }).notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.eventId, t.mac, t.port] }),
    seenIdx: index("ports_event_last_seen_idx").on(t.eventId, t.lastSeen),
  }),
);

export const reads = pgTable(
  "reads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    mac: text("mac").notNull(),
    port: integer("port").notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
  },
  (t) => ({
    evTsIdx: index("reads_event_ts_idx").on(t.eventId, t.ts.desc()),
    evMacTsIdx: index("reads_event_mac_ts_idx").on(t.eventId, t.mac, t.ts.desc()),
    evMacPortTsIdx: index("reads_event_mac_port_ts_idx").on(
      t.eventId,
      t.mac,
      t.port,
      t.ts.desc(),
    ),
  }),
);

export const timerWorkspaces = pgTable(
  "timer_workspaces",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    payload: jsonb("payload").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.eventId, t.workspaceId] }),
  }),
);

/** Soft cap: creations per IP per hour bucket. */
export const creationIpHour = pgTable(
  "creation_ip_hour",
  {
    ipHash: text("ip_hash").notNull(),
    hourBucket: timestamp("hour_bucket", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.ipHash, t.hourBucket] }),
  }),
);
