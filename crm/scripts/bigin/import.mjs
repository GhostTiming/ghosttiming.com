import { createHash } from "node:crypto";
import { join } from "node:path";
import nextEnv from "@next/env";
import pg from "pg";
import { readCsv, text, truthy } from "./common.mjs";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const directory = process.argv.find((argument) => !argument.startsWith("--") && argument !== process.argv[0] && argument !== process.argv[1]);
const apply = process.argv.includes("--apply");
if (!directory) throw new Error("Pass the directory containing the Bigin CSV files.");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");

const paths = {
  accounts: join(directory, "Accounts_2026_09_15.csv"),
  contacts: join(directory, "Contacts_2026_09_15.csv"),
  calendarEvents: join(directory, "Events_2026_09_15.csv"),
  pipelines: join(directory, "Pipelines_2026_09_15.csv"),
  tasks: join(directory, "Tasks_2026_09_15.csv"),
};
const [accounts, contacts, calendarEvents, pipelines, tasks] = await Promise.all(
  Object.values(paths).map(readCsv),
);

function uuidFor(type, externalId) {
  const bytes = createHash("sha256")
    .update(`bigin:${type}:${externalId}`, "utf8")
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function normalizedEventName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/^\s*(19|20)\d{2}\s+/, "")
    .replace(/\s*-\s*(renewal|new|timing lead)\s*$/i, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function eventDisplayName(value) {
  return String(value ?? "")
    .trim()
    .replace(/^\s*(19|20)\d{2}\s+/, "")
    .replace(/\s*-\s*(renewal|new|timing lead)\s*$/i, "")
    .trim();
}

function yearFor(record) {
  const dateYear = text(record["Closing Date"])?.match(/^(\d{4})/)?.[1];
  const nameYear = text(record["Event Name"])?.match(/^\s*((?:19|20)\d{2})/)?.[1];
  return Number(dateYear ?? nameYear) || null;
}

function numeric(value) {
  const parsed = Number(String(value ?? "").replace(/[$,]/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function easternDateToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "America/New_York",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function timerLocation(value) {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized.includes("remote")) return "remote";
  if (normalized.includes("site")) return "on_site";
  return null;
}

function sanitizeRaw(record) {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      typeof value === "string" ? value.replaceAll("\0", "") : value,
    ]),
  );
}

function legacyNotes(record) {
  return [
    ["Start / split / finish points", text(record["Start/Split/Finish Points"])],
    ["Race details", text(record["Event Distance(s)/Start Time(s)"])],
    ["Awards and age groups", text(record["Awards and Age Groups per Event"])],
    ["Crew", text(record.Crew)],
    ["Outreach sentiment", text(record["Outreach Sentiment"])],
    ["Closed lost reason", text(record["Closed Lost Reason"])],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}:\n${value}`)
    .join("\n\n") || null;
}

function parseRaceLines(record) {
  const source = text(record["Event Distance(s)/Start Time(s)"]);
  const date = text(record["Closing Date"]);
  if (!source || !date || source.toLowerCase() === "na") return [];
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const match = line.match(/(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)/i);
      if (!match) return [];
      let hour = Number(match[1]);
      const minute = match[2];
      const period = match[3].toLowerCase().startsWith("p") ? "pm" : "am";
      if (period === "pm" && hour < 12) hour += 12;
      if (period === "am" && hour === 12) hour = 0;
      const name = line
        .slice(0, match.index)
        .replace(/[-:–—]\s*(starts?|start)?\s*(at)?\s*$/i, "")
        .trim() || eventDisplayName(record["Event Name"]);
      const distance = name.match(
        /(\d+(?:\.\d+)?\s*(?:k|km|miles?|mi)\b|half marathon|marathon)/i,
      )?.[1];
      return [{
        name: name.slice(0, 500),
        distanceLabel: distance ?? null,
        startTime: `${date} ${String(hour).padStart(2, "0")}:${minute}:00`,
      }];
    });
}

function durationMinutes(distanceLabel) {
  const value = String(distanceLabel ?? "").toLowerCase();
  if (value.includes("half")) return 180;
  if (value.includes("marathon")) return 360;
  const kilometers = value.match(/(\d+(?:\.\d+)?)\s*(?:k|km)/)?.[1];
  const miles = value.match(/(\d+(?:\.\d+)?)\s*(?:mile|miles|mi)\b/)?.[1];
  const distanceMiles = kilometers
    ? Number(kilometers) * 0.621371
    : miles
      ? Number(miles)
      : null;
  return distanceMiles ? Math.max(30, Math.ceil((distanceMiles * 25) / 5) * 5) : 120;
}

function parseCoursePoints(record) {
  const source = text(record["Start/Split/Finish Points"]);
  if (!source) return [];
  return source
    .split(/\n\s*\n|\r?\n(?=(?:start|finish|mile|split|bottom|top)\b)/i)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((notes) => ({
      name: notes.split(/[,—–:\n]/, 1)[0].trim().slice(0, 300) || "Course point",
      notes: notes.slice(0, 5_000),
    }));
}

function parseCrew(record) {
  const source = text(record.Crew);
  if (!source) return [];
  return source
    .split(/\n\s*\n|\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((notes) => ({
      name: notes.split(/[—–,\n]/, 1)[0].trim().slice(0, 300),
      notes: notes.slice(0, 5_000),
    }));
}

const accountById = new Map(accounts.map((record) => [record["Account Id"], record]));
const contactIds = new Set(contacts.map((record) => record["Contact Id"]));
const pipelineAccountIds = new Set(
  pipelines.map((record) => text(record["Account Name.id"])).filter(Boolean),
);
const organizationAccounts = accounts.filter(
  (record) =>
    text(record["Account Type"]) === "Event/Timing Company" ||
    (!pipelineAccountIds.has(record["Account Id"]) &&
      text(record["Account Type"]) !== "Event"),
);
const eventAccounts = accounts.filter(
  (record) =>
    text(record["Account Type"]) === "Event" ||
    pipelineAccountIds.has(record["Account Id"]),
);
const eventAccountsByName = eventAccounts.reduce((map, account) => {
  const key = normalizedEventName(account["Account Name"]);
  const matches = map.get(key) ?? [];
  matches.push(account);
  map.set(key, matches);
  return map;
}, new Map());
const calendarByPipeline = calendarEvents.reduce((map, record) => {
  const key = text(record["Related To.id"]);
  if (key && !map.has(key)) map.set(key, record);
  return map;
}, new Map());

const fallbackOrganizationId = uuidFor("organization", "unassigned-client");
const organizationIds = new Map(
  organizationAccounts.map((record) => [
    record["Account Id"],
    uuidFor("organization", record["Account Id"]),
  ]),
);
organizationIds.set("unassigned-client", fallbackOrganizationId);

const eventPlans = new Map();
for (const account of eventAccounts) {
  const externalId = account["Account Id"];
  eventPlans.set(`account:${externalId}`, {
    id: uuidFor("event", externalId),
    externalId,
    name: text(account["Account Name"]),
    account,
  });
}

const usedOccurrenceSlots = new Set();
const pipelinePlans = [];
let duplicateOccurrenceSlots = 0;
for (const record of pipelines) {
  const externalId = record["Event Id"];
  const explicit = eventPlans.has(`account:${record["Account Name.id"]}`)
    ? accountById.get(record["Account Name.id"])
    : null;
  const nameMatches =
    eventAccountsByName.get(normalizedEventName(record["Event Name"])) ?? [];
  const matchedAccount = explicit ?? (nameMatches.length === 1 ? nameMatches[0] : null);
  let eventKey = matchedAccount
    ? `account:${matchedAccount["Account Id"]}`
    : `name:${normalizedEventName(record["Event Name"]) || externalId}`;
  if (!eventPlans.has(eventKey)) {
    eventPlans.set(eventKey, {
      id: uuidFor("event-group", eventKey),
      externalId: null,
      name: eventDisplayName(record["Event Name"]),
      account: null,
    });
  }
  const slot = `${eventKey}:${yearFor(record) ?? "unknown"}`;
  if (usedOccurrenceSlots.has(slot)) {
    duplicateOccurrenceSlots += 1;
    eventKey = `${eventKey}:duplicate:${externalId}`;
    eventPlans.set(eventKey, {
      id: uuidFor("event-group", eventKey),
      externalId: null,
      name: eventDisplayName(record["Event Name"]),
      account: null,
    });
  }
  usedOccurrenceSlots.add(`${eventKey}:${yearFor(record) ?? "unknown"}`);
  const parentAccountId = matchedAccount
    ? text(matchedAccount["Parent Account.id"])
    : null;
  const directClientId =
    (parentAccountId && organizationIds.get(parentAccountId)) ??
    fallbackOrganizationId;
  const stage = text(record.Stage);
  const kind = ["Confirmed", "Completed", "Paid"].includes(stage)
    ? "booking"
    : "prospect";
  pipelinePlans.push({
    record,
    externalId,
    event: eventPlans.get(eventKey),
    occurrenceId: uuidFor("occurrence", externalId),
    directClientId,
    kind,
    calendar: calendarByPipeline.get(externalId) ?? null,
  });
}

const validStages = new Set([
  "Cold",
  "Scoping",
  "Closed Lost",
  "Confirmed",
  "Completed",
  "Paid",
]);
const errors = [
  ...accounts.filter((record) => !text(record["Account Id"]) || !text(record["Account Name"]))
    .map((record) => `Invalid account: ${JSON.stringify(record)}`),
  ...contacts.filter((record) => !text(record["Contact Id"]) || !text(record["Contact Name"]))
    .map((record) => `Invalid contact: ${JSON.stringify(record)}`),
  ...pipelines.filter(
    (record) =>
      !text(record["Event Id"]) ||
      !text(record["Event Name"]) ||
      !validStages.has(text(record.Stage)),
  ).map((record) => `Invalid pipeline: ${JSON.stringify(record)}`),
  ...tasks.filter(
    (record) =>
      !text(record["Task Id"]) ||
      !text(record.Subject) ||
      !text(record["Due Date"]) ||
      !pipelinePlans.some((plan) => plan.externalId === record["Related To.id"]),
  ).map((record) => `Invalid task: ${JSON.stringify(record)}`),
];

const summary = {
  mode: apply ? "apply" : "dry-run",
  source: {
    accounts: accounts.length,
    contacts: contacts.length,
    calendar_events: calendarEvents.length,
    pipelines: pipelines.length,
    tasks: tasks.length,
  },
  planned: {
    organizations: organizationAccounts.length + 1,
    events: eventPlans.size,
    occurrences: pipelinePlans.length,
    people: contacts.length,
    prospects: pipelinePlans.filter((plan) => plan.kind === "prospect").length,
    bookings: pipelinePlans.filter((plan) => plan.kind === "booking").length,
    tasks: tasks.length,
    races: pipelinePlans.reduce(
      (count, plan) => count + parseRaceLines(plan.record).length,
      0,
    ),
    course_points: pipelinePlans.reduce(
      (count, plan) => count + parseCoursePoints(plan.record).length,
      0,
    ),
    crew_assignments: pipelinePlans.reduce(
      (count, plan) => count + parseCrew(plan.record).length,
      0,
    ),
    external_records:
      accounts.length +
      contacts.length +
      calendarEvents.length +
      pipelines.length +
      tasks.length,
  },
  duplicate_occurrence_slots_disambiguated: duplicateOccurrenceSlots,
  validation_errors: errors,
};

if (errors.length) {
  console.error(JSON.stringify(summary, null, 2));
  process.exitCode = 1;
} else if (!apply) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  const localOrganizationIds = new Map(organizationIds);
  const stageIds = new Map();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL TIME ZONE 'America/New_York'`);
    const users = await client.query(
      `SELECT id::text FROM crm.users WHERE is_active = true
       ORDER BY CASE WHEN role = 'admin' THEN 0 ELSE 1 END, created_at LIMIT 1`,
    );
    const assignedUserId = users.rows[0]?.id;
    if (!assignedUserId) throw new Error("No active CRM user exists for imported ownership.");
    const stages = await client.query(
      `SELECT id::text, pipeline, key FROM crm.pipeline_stages WHERE is_active = true`,
    );
    for (const stage of stages.rows) {
      stageIds.set(`${stage.pipeline}:${stage.key}`, stage.id);
    }
    for (const required of [
      "prospect:cold",
      "prospect:scoping",
      "prospect:closed_lost",
      "booking:confirmed",
      "booking:completed",
      "booking:paid",
    ]) {
      if (!stageIds.has(required)) throw new Error(`Missing pipeline stage ${required}.`);
    }

    async function externalRecord(entityType, externalId, localId, rawData) {
      await client.query(
        `INSERT INTO crm.external_records
           (source, entity_type, external_id, local_id, raw_data)
         VALUES ('bigin', $1, $2, $3::uuid, $4::jsonb)
         ON CONFLICT (source, entity_type, external_id) DO UPDATE
         SET local_id = EXCLUDED.local_id, raw_data = EXCLUDED.raw_data,
             updated_at = now()`,
        [entityType, externalId, localId, JSON.stringify(sanitizeRaw(rawData))],
      );
    }

    for (const account of organizationAccounts) {
      const proposedId = organizationIds.get(account["Account Id"]);
      const existing = await client.query(
        `SELECT id::text FROM crm.organizations
         WHERE lower(name) = lower($1) ORDER BY created_at LIMIT 1`,
        [account["Account Name"]],
      );
      const chosenId = existing.rows[0]?.id ?? proposedId;
      const organization = await client.query(
        `INSERT INTO crm.organizations
           (id, name, website, phone, notes, created_at, updated_at)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET
           website = COALESCE(EXCLUDED.website, organizations.website),
           phone = COALESCE(EXCLUDED.phone, organizations.phone),
           updated_at = GREATEST(organizations.updated_at, EXCLUDED.updated_at)
         RETURNING id::text`,
        [
          chosenId,
          account["Account Name"],
          text(account.Website),
          text(account.Phone),
          text(account.Tag) ? `Bigin tags: ${account.Tag}` : null,
          text(account["Created Time"]),
          text(account["Modified Time"]),
        ],
      );
      const localId = organization.rows[0].id;
      localOrganizationIds.set(account["Account Id"], localId);
      const roles =
        text(account["Account Type"]) === "Event/Timing Company"
          ? ["direct_client", "timing_company"]
          : ["other"];
      for (const role of roles) {
        await client.query(
          `INSERT INTO crm.organization_roles (organization_id, role)
           VALUES ($1::uuid, $2::crm.organization_role)
           ON CONFLICT (organization_id, role) DO NOTHING`,
          [localId, role],
        );
      }
      await externalRecord("account", account["Account Id"], localId, account);
    }
    const existingFallback = await client.query(
      `SELECT id::text FROM crm.organizations
       WHERE lower(name) = lower('Unassigned Bigin Client')
       ORDER BY created_at LIMIT 1`,
    );
    const chosenFallbackId =
      existingFallback.rows[0]?.id ?? fallbackOrganizationId;
    await client.query(
      `INSERT INTO crm.organizations (id, name, notes)
       VALUES ($1::uuid, 'Unassigned Bigin Client',
         'Fallback for legacy Bigin records that did not identify an account.')
       ON CONFLICT (id) DO UPDATE SET updated_at = now()
       RETURNING id::text`,
      [chosenFallbackId],
    ).then((result) => {
      localOrganizationIds.set("unassigned-client", result.rows[0].id);
    });
    for (const role of ["direct_client", "other"]) {
      await client.query(
        `INSERT INTO crm.organization_roles (organization_id, role)
         VALUES ($1::uuid, $2::crm.organization_role)
         ON CONFLICT (organization_id, role) DO NOTHING`,
        [localOrganizationIds.get("unassigned-client"), role],
      );
    }

    for (const account of organizationAccounts) {
      const parentId = text(account["Parent Account.id"]);
      if (!parentId || !localOrganizationIds.has(parentId)) continue;
      await client.query(
        `INSERT INTO crm.organization_relationships
           (source_organization_id, target_organization_id, relationship_type)
         VALUES ($1::uuid, $2::uuid, 'client_of')
         ON CONFLICT (source_organization_id, target_organization_id,
           relationship_type) DO NOTHING`,
        [localOrganizationIds.get(account["Account Id"]), localOrganizationIds.get(parentId)],
      );
    }

    for (const event of eventPlans.values()) {
      const parentId = text(event.account?.["Parent Account.id"]);
      const ownerId = parentId
        ? localOrganizationIds.get(parentId) ?? null
        : null;
      await client.query(
        `INSERT INTO crm.events
           (id, name, source_type, external_source_id,
            default_owner_organization_id, website, notes)
         VALUES ($1::uuid, $2, 'other', $3, $4::uuid, $5, $6)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           default_owner_organization_id = EXCLUDED.default_owner_organization_id,
           website = COALESCE(EXCLUDED.website, events.website),
           notes = COALESCE(EXCLUDED.notes, events.notes),
           updated_at = now()`,
        [
          event.id,
          event.name,
          event.externalId,
          ownerId,
          text(event.account?.Website),
          text(event.account?.Tag) ? `Bigin tags: ${event.account.Tag}` : null,
        ],
      );
      if (event.account) {
        await externalRecord("account", event.externalId, event.id, event.account);
      }
    }

    for (const plan of pipelinePlans) {
      const { record, calendar } = plan;
      const directClientId =
        plan.directClientId === fallbackOrganizationId
          ? localOrganizationIds.get("unassigned-client")
          : localOrganizationIds.get(
              text(plan.event.account?.["Parent Account.id"]),
            ) ?? localOrganizationIds.get("unassigned-client");
      plan.directClientId = directClientId;
      const date = text(record["Closing Date"]);
      const arrival =
        text(record["Arr. Time"]) ?? text(calendar?.Arrival) ?? text(calendar?.From);
      const departure =
        text(record["Depart. Time"]) ??
        text(calendar?.Departure) ??
        text(calendar?.To);
      const registrationUrl =
        text(record["Race Registration Site"]) ??
        text(calendar?.["Race Registration Site"]);
      const address = text(record.Address) ?? text(calendar?.Address);
      const operationsNotes = legacyNotes(record);
      await client.query(
        `INSERT INTO crm.event_occurrences
           (id, event_id, occurrence_year, race_date, timezone,
            event_owner_organization_id, registration_url_override,
            street_override, timer_location, hardware_event_name,
            scoring_expectations, post_event_expectations, notes,
            arrival_override_at, departure_override_at, created_at, updated_at)
         VALUES (
           $1::uuid, $2::uuid, $3,
           CASE WHEN $4::text IS NULL THEN NULL
             ELSE $4::date::timestamp AT TIME ZONE 'America/New_York' END,
           'America/New_York', $5::uuid, $6, $7,
           $8::crm.timer_location, $9, $10, $11, $12,
           CASE WHEN $13::text IS NULL THEN NULL
             ELSE $13::timestamp AT TIME ZONE 'America/New_York' END,
           CASE WHEN $14::text IS NULL THEN NULL
             ELSE $14::timestamp AT TIME ZONE 'America/New_York' END,
           $15, $16)
         ON CONFLICT (id) DO UPDATE SET
           event_id = EXCLUDED.event_id,
           occurrence_year = EXCLUDED.occurrence_year,
           race_date = EXCLUDED.race_date,
           event_owner_organization_id = EXCLUDED.event_owner_organization_id,
           registration_url_override = EXCLUDED.registration_url_override,
           street_override = EXCLUDED.street_override,
           timer_location = EXCLUDED.timer_location,
           hardware_event_name = EXCLUDED.hardware_event_name,
           scoring_expectations = EXCLUDED.scoring_expectations,
           post_event_expectations = EXCLUDED.post_event_expectations,
           notes = EXCLUDED.notes,
           arrival_override_at = EXCLUDED.arrival_override_at,
           departure_override_at = EXCLUDED.departure_override_at,
           updated_at = EXCLUDED.updated_at`,
        [
          plan.occurrenceId,
          plan.event.id,
          yearFor(record),
          date,
          directClientId,
          registrationUrl,
          address,
          timerLocation(
            text(record["Onsite or Remote"]) ?? text(calendar?.["Onsite or Remote"]),
          ),
          text(record["Event & Point Name"]) ??
            text(calendar?.["Event & Point Name"]),
          text(record["Additional Scoring/Support Expectations"]) ??
            text(calendar?.["Additional Scoring/Support Expectations"]),
          text(record["Post-Event Expectations"]) ??
            text(calendar?.["Post-Event Expectations"]),
          operationsNotes,
          arrival,
          departure,
          text(record["Created Time"]),
          text(record["Modified Time"]),
        ],
      );
    }

    for (const contact of contacts) {
      const proposedId = uuidFor("person", contact["Contact Id"]);
      const account = accountById.get(contact["Account Name.id"]);
      const organizationId =
        localOrganizationIds.get(contact["Account Name.id"]) ??
        localOrganizationIds.get(text(account?.["Parent Account.id"])) ??
        null;
      const notes = [
        text(contact.Description),
        text(contact.Tag) ? `Bigin tags: ${contact.Tag}` : null,
        [
          text(contact["Mailing Street"]),
          text(contact["Mailing City"]),
          text(contact["Mailing State"]),
          text(contact["Mailing Country"]),
          text(contact["Mailing Zip"]),
        ].filter(Boolean).join(", ") || null,
      ].filter(Boolean).join("\n\n") || null;
      await client.query(
        `INSERT INTO crm.people
           (id, organization_id, display_name, first_name, last_name, title,
            email, phone, notes, contact_type, do_not_contact, email_opt_out,
            created_at, updated_at)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10,
           $11, $12, $13, $14)
         ON CONFLICT (id) DO UPDATE SET
           organization_id = EXCLUDED.organization_id,
           display_name = EXCLUDED.display_name,
           first_name = EXCLUDED.first_name,
           last_name = EXCLUDED.last_name,
           title = EXCLUDED.title,
           email = EXCLUDED.email,
           phone = EXCLUDED.phone,
           notes = EXCLUDED.notes,
           contact_type = EXCLUDED.contact_type,
           do_not_contact = EXCLUDED.do_not_contact,
           email_opt_out = EXCLUDED.email_opt_out,
           updated_at = EXCLUDED.updated_at`,
        [
          proposedId,
          organizationId,
          contact["Contact Name"],
          text(contact["First Name"]),
          text(contact["Last Name"]),
          text(contact.Title),
          text(contact.Email),
          text(contact.Mobile) ?? text(contact.Phone) ?? text(contact["Home Phone"]),
          notes,
          text(contact["Contact Type"]),
          truthy(contact.DNC),
          truthy(contact["Email Opt Out"]),
          text(contact["Created Time"]),
          text(contact["Modified Time"]),
        ],
      );
      await externalRecord("contact", contact["Contact Id"], proposedId, contact);
    }

    const prospectStage = {
      Cold: "cold",
      Scoping: "scoping",
      "Closed Lost": "closed_lost",
    };
    const bookingStage = {
      Confirmed: "confirmed",
      Completed: "completed",
      Paid: "paid",
    };
    for (const plan of pipelinePlans) {
      const { record } = plan;
      const localId = uuidFor(plan.kind, plan.externalId);
      const sourceContactId = text(record["Contact Name.id"]);
      const primaryContactId =
        sourceContactId && contactIds.has(sourceContactId)
          ? uuidFor("person", sourceContactId)
          : null;
      if (plan.kind === "prospect") {
        const stageKey = prospectStage[record.Stage];
        await client.query(
          `INSERT INTO crm.prospects
             (id, event_id, occurrence_id, primary_contact_person_id,
              stage_id, assigned_user_id,
              do_not_contact, closed_at, created_at, updated_at)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid,
             false,
             CASE WHEN $7 = 'closed_lost' THEN $8::timestamptz ELSE NULL END,
             $9, $8)
           ON CONFLICT (id) DO UPDATE SET
             event_id = EXCLUDED.event_id,
             occurrence_id = EXCLUDED.occurrence_id,
             primary_contact_person_id = EXCLUDED.primary_contact_person_id,
             stage_id = EXCLUDED.stage_id,
             assigned_user_id = EXCLUDED.assigned_user_id,
             closed_at = EXCLUDED.closed_at,
             updated_at = EXCLUDED.updated_at`,
          [
            localId,
            plan.event.id,
            plan.occurrenceId,
            primaryContactId,
            stageIds.get(`prospect:${stageKey}`),
            assignedUserId,
            stageKey,
            text(record["Modified Time"]),
            text(record["Created Time"]),
          ],
        );
      } else {
        const stageKey = bookingStage[record.Stage];
        const amount = numeric(record.Amount);
        const sourceExpected = numeric(record["Expected Revenue"]);
        const expected =
          stageKey === "confirmed" &&
          text(record["Closing Date"]) > easternDateToday()
            ? 300
            : sourceExpected;
        const stageChangedAt = text(record["Modified Time"]);
        await client.query(
          `INSERT INTO crm.bookings
             (id, occurrence_id, direct_client_organization_id,
              primary_contact_person_id, stage_id,
              assigned_user_id, expected_revenue, actual_revenue, amount_paid,
              payment_due_at, payment_at, completed_at, notes, created_at, updated_at)
           VALUES (
             $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid,
             $7::numeric, $8::numeric,
             CASE WHEN $9 = 'paid'
               THEN COALESCE($8::numeric, 0::numeric) ELSE 0::numeric END,
             CASE WHEN $9 IN ('completed', 'paid')
               THEN $10::timestamptz + interval '30 days' ELSE NULL END,
             CASE WHEN $9 = 'paid' THEN $10::timestamptz ELSE NULL END,
             CASE WHEN $9 IN ('completed', 'paid') THEN $10::timestamptz ELSE NULL END,
             $11, $12, $10)
           ON CONFLICT (id) DO UPDATE SET
             occurrence_id = EXCLUDED.occurrence_id,
             direct_client_organization_id = EXCLUDED.direct_client_organization_id,
             primary_contact_person_id = EXCLUDED.primary_contact_person_id,
             stage_id = EXCLUDED.stage_id,
             assigned_user_id = EXCLUDED.assigned_user_id,
             expected_revenue = EXCLUDED.expected_revenue,
             actual_revenue = EXCLUDED.actual_revenue,
             amount_paid = EXCLUDED.amount_paid,
             payment_due_at = EXCLUDED.payment_due_at,
             payment_at = EXCLUDED.payment_at,
             completed_at = EXCLUDED.completed_at,
             notes = EXCLUDED.notes,
             updated_at = EXCLUDED.updated_at`,
          [
            localId,
            plan.occurrenceId,
            plan.directClientId,
            primaryContactId,
            stageIds.get(`booking:${stageKey}`),
            assignedUserId,
            expected,
            amount,
            stageKey,
            stageChangedAt,
            legacyNotes(record),
            text(record["Created Time"]),
          ],
        );
        for (const [key, label] of [
          ["crew_email_sent", "Crew email sent"],
          ["race_built", "Race built"],
        ]) {
          const status = ["completed", "paid"].includes(stageKey)
            ? "complete"
            : "pending";
          await client.query(
            `INSERT INTO crm.booking_prep_items
               (id, booking_id, key, label, status)
             VALUES ($1::uuid, $2::uuid, $3, $4, $5::crm.prep_item_status)
             ON CONFLICT (booking_id, key) DO UPDATE SET
               label = EXCLUDED.label, status = EXCLUDED.status, updated_at = now()`,
            [uuidFor("prep", `${plan.externalId}:${key}`), localId, key, label, status],
          );
        }
      }
      await externalRecord(plan.kind, plan.externalId, localId, record);

      const note = [
        text(record["Outreach Sentiment"])
          ? `Outreach sentiment: ${record["Outreach Sentiment"]}`
          : null,
        text(record["Closed Lost Reason"])
          ? `Closed lost reason: ${record["Closed Lost Reason"]}`
          : null,
      ].filter(Boolean).join("\n");
      if (note) {
        await client.query(
          `INSERT INTO crm.activities
             (id, prospect_id, booking_id, type, body, occurred_at,
              actor_type, actor_name, metadata)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 'note', $4, $5,
             'system', 'Bigin Import', $6::jsonb)
           ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body,
             occurred_at = EXCLUDED.occurred_at, metadata = EXCLUDED.metadata`,
          [
            uuidFor("pipeline-note", plan.externalId),
            plan.kind === "prospect" ? localId : null,
            plan.kind === "booking" ? localId : null,
            note,
            text(record["Modified Time"]),
            JSON.stringify({ source: "bigin", external_id: plan.externalId }),
          ],
        );
      }

      if (plan.kind === "booking") {
        const races = parseRaceLines(record);
        for (const [index, race] of races.entries()) {
          await client.query(
            `INSERT INTO crm.occurrence_races
               (id, occurrence_id, name, distance_label, start_time,
                awards, estimated_duration_minutes, sort_order)
             VALUES ($1::uuid, $2::uuid, $3, $4, $5::timestamp, $6, $7, $8)
             ON CONFLICT (id) DO UPDATE SET
               name = EXCLUDED.name, distance_label = EXCLUDED.distance_label,
               start_time = EXCLUDED.start_time, awards = EXCLUDED.awards,
               estimated_duration_minutes = EXCLUDED.estimated_duration_minutes,
               sort_order = EXCLUDED.sort_order, updated_at = now()`,
            [
              uuidFor("race", `${plan.externalId}:${index}`),
              plan.occurrenceId,
              race.name,
              race.distanceLabel,
              race.startTime,
              text(record["Awards and Age Groups per Event"]),
              durationMinutes(race.distanceLabel),
              index,
            ],
          );
        }
        const points = parseCoursePoints(record);
        for (const [index, point] of points.entries()) {
          await client.query(
            `INSERT INTO crm.course_points
               (id, occurrence_id, name, notes, sort_order)
             VALUES ($1::uuid, $2::uuid, $3, $4, $5)
             ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name,
               notes = EXCLUDED.notes, sort_order = EXCLUDED.sort_order,
               updated_at = now()`,
            [
              uuidFor("course-point", `${plan.externalId}:${index}`),
              plan.occurrenceId,
              point.name,
              point.notes,
              index,
            ],
          );
        }
        const crew = parseCrew(record);
        for (const [index, assignment] of crew.entries()) {
          await client.query(
            `INSERT INTO crm.crew_assignments
               (id, occurrence_id, freeform_name, notes)
             VALUES ($1::uuid, $2::uuid, $3, $4)
             ON CONFLICT (id) DO UPDATE SET
               freeform_name = EXCLUDED.freeform_name,
               notes = EXCLUDED.notes, updated_at = now()`,
            [
              uuidFor("crew", `${plan.externalId}:${index}`),
              plan.occurrenceId,
              assignment.name,
              assignment.notes,
            ],
          );
        }
      }
    }

    const pipelinePlanById = new Map(
      pipelinePlans.map((plan) => [plan.externalId, plan]),
    );
    for (const task of tasks) {
      const plan = pipelinePlanById.get(task["Related To.id"]);
      const taskId = uuidFor("task", task["Task Id"]);
      const relatedId = uuidFor(plan.kind, plan.externalId);
      const complete = text(task.Status) === "Completed";
      await client.query(
        `INSERT INTO crm.tasks
           (id, prospect_id, booking_id, title, due_at, status,
            assigned_user_id, completed_at, created_at, updated_at)
         VALUES (
           $1::uuid, $2::uuid, $3::uuid, $4,
           CASE WHEN $5::text IS NULL THEN NULL
             ELSE ($5::date + time '09:00') AT TIME ZONE 'America/New_York' END,
           $6::crm.task_status, $7::uuid,
           CASE WHEN $6::text = 'complete'
             THEN ($5::date + time '09:00') AT TIME ZONE 'America/New_York'
             ELSE NULL END,
           now(), now())
         ON CONFLICT (id) DO UPDATE SET
           prospect_id = EXCLUDED.prospect_id,
           booking_id = EXCLUDED.booking_id,
           title = EXCLUDED.title,
           due_at = EXCLUDED.due_at,
           status = EXCLUDED.status,
           assigned_user_id = EXCLUDED.assigned_user_id,
           completed_at = EXCLUDED.completed_at,
           updated_at = now()`,
        [
          taskId,
          plan.kind === "prospect" ? relatedId : null,
          plan.kind === "booking" ? relatedId : null,
          task.Subject,
          text(task["Due Date"]),
          complete ? "complete" : "open",
          assignedUserId,
        ],
      );
      await externalRecord("task", task["Task Id"], taskId, task);
    }

    for (const calendar of calendarEvents) {
      const plan = pipelinePlanById.get(calendar["Related To.id"]);
      await externalRecord(
        "calendar_event",
        calendar["Event Id"],
        plan.occurrenceId,
        calendar,
      );
    }

    await client.query("COMMIT");
    console.log(JSON.stringify({ ...summary, committed: true }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
