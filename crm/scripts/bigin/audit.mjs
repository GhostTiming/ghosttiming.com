import { join } from "node:path";
import { frequencies, readCsv, text, truthy } from "./common.mjs";

const directory = process.argv[2];
if (!directory) throw new Error("Pass the directory containing the Bigin CSV files.");

const paths = {
  accounts: join(directory, "Accounts_2026_09_15.csv"),
  contacts: join(directory, "Contacts_2026_09_15.csv"),
  events: join(directory, "Events_2026_09_15.csv"),
  pipelines: join(directory, "Pipelines_2026_09_15.csv"),
  tasks: join(directory, "Tasks_2026_09_15.csv"),
};
const [accounts, contacts, events, pipelines, tasks] = await Promise.all(
  Object.values(paths).map(readCsv),
);
const accountIds = new Set(accounts.map((record) => record["Account Id"]));
const pipelineIds = new Set(pipelines.map((record) => record["Event Id"]));
const eventAccounts = accounts.filter(
  (record) => text(record["Account Type"]) === "Event",
);

function normalizedEventName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/^\s*(19|20)\d{2}\s+/, "")
    .replace(/\s*-\s*(renewal|new)\s*$/i, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const eventAccountsByName = eventAccounts.reduce((map, account) => {
  const key = normalizedEventName(account["Account Name"]);
  const matches = map.get(key) ?? [];
  matches.push(account);
  map.set(key, matches);
  return map;
}, new Map());
const pipelineNameMatches = pipelines.map((record) => {
  if (text(record["Account Name.id"])) return "explicit";
  const matches =
    eventAccountsByName.get(normalizedEventName(record["Event Name"])) ?? [];
  return matches.length === 1 ? "name" : matches.length > 1 ? "ambiguous" : "none";
});

function duplicateCount(records, field) {
  const ids = records.map((record) => text(record[field])).filter(Boolean);
  return ids.length - new Set(ids).size;
}

function filled(records, field) {
  return records.filter((record) => text(record[field])).length;
}

console.log(
  JSON.stringify(
    {
      files: Object.fromEntries(
        Object.entries(paths).map(([key, path]) => [key, path]),
      ),
      counts: {
        accounts: accounts.length,
        contacts: contacts.length,
        events: events.length,
        pipelines: pipelines.length,
        tasks: tasks.length,
      },
      duplicate_ids: {
        accounts: duplicateCount(accounts, "Account Id"),
        contacts: duplicateCount(contacts, "Contact Id"),
        events: duplicateCount(events, "Event Id"),
        pipelines: duplicateCount(pipelines, "Event Id"),
        tasks: duplicateCount(tasks, "Task Id"),
      },
      accounts: {
        types: frequencies(accounts, "Account Type"),
        blank_type_names: accounts
          .filter((record) => !text(record["Account Type"]))
          .map((record) => record["Account Name"]),
        missing_names: accounts.filter((record) => !text(record["Account Name"]))
          .length,
        parent_links: filled(accounts, "Parent Account.id"),
        broken_parent_links: accounts.filter(
          (record) =>
            text(record["Parent Account.id"]) &&
            !accountIds.has(record["Parent Account.id"]),
        ).length,
      },
      contacts: {
        types: frequencies(contacts, "Contact Type"),
        linked_accounts: filled(contacts, "Account Name.id"),
        broken_account_links: contacts.filter(
          (record) =>
            text(record["Account Name.id"]) &&
            !accountIds.has(record["Account Name.id"]),
        ).length,
        dnc: contacts.filter((record) => truthy(record.DNC)).length,
        email_opt_out: contacts.filter((record) =>
          truthy(record["Email Opt Out"]),
        ).length,
        with_email: filled(contacts, "Email"),
        with_phone: contacts.filter(
          (record) =>
            text(record.Mobile) ||
            text(record.Phone) ||
            text(record["Home Phone"]),
        ).length,
      },
      pipelines: {
        pipeline_names: frequencies(pipelines, "Pipeline"),
        stages: frequencies(pipelines, "Stage"),
        linked_accounts: filled(pipelines, "Account Name.id"),
        broken_account_links: pipelines.filter(
          (record) =>
            text(record["Account Name.id"]) &&
            !accountIds.has(record["Account Name.id"]),
        ).length,
        account_resolution: frequencies(
          pipelineNameMatches.map((resolution) => ({ resolution })),
          "resolution",
        ),
        resolution_by_stage: pipelines.reduce((summary, record, index) => {
          const stage = text(record.Stage) ?? "(blank)";
          const resolution = pipelineNameMatches[index];
          summary[stage] ??= {};
          summary[stage][resolution] =
            (summary[stage][resolution] ?? 0) + 1;
          return summary;
        }, {}),
        unmatched_event_names: pipelines
          .filter((record, index) => pipelineNameMatches[index] === "none")
          .slice(0, 30)
          .map((record) => record["Event Name"]),
        custom_account_values: frequencies(pipelines, "Account"),
        custom_fields_filled: Object.fromEntries(
          [
            "Race Registration Site",
            "Address",
            "Arr. Time",
            "Depart. Time",
            "Onsite or Remote",
            "Event & Point Name",
            "Crew",
            "Start/Split/Finish Points",
            "Event Distance(s)/Start Time(s)",
            "Awards and Age Groups per Event",
            "Additional Scoring/Support Expectations",
            "Post-Event Expectations",
            "Outreach Sentiment",
            "Closed Lost Reason",
          ].map((field) => [field, filled(pipelines, field)]),
        ),
        operational_samples: pipelines
          .filter((record) => text(record["Event Distance(s)/Start Time(s)"]))
          .slice(0, 8)
          .map((record) => ({
            name: record["Event Name"],
            date: record["Closing Date"],
            arrival: record["Arr. Time"],
            departure: record["Depart. Time"],
            races: record["Event Distance(s)/Start Time(s)"],
            points: record["Start/Split/Finish Points"],
            awards: record["Awards and Age Groups per Event"],
            crew: record.Crew,
          })),
      },
      calendar_events: {
        related_to_pipeline: events.filter((record) =>
          pipelineIds.has(record["Related To.id"]),
        ).length,
        broken_related_links: events.filter(
          (record) =>
            text(record["Related To.id"]) &&
            !pipelineIds.has(record["Related To.id"]),
        ).length,
        custom_fields_filled: Object.fromEntries(
          [
            "Arrival",
            "Departure",
            "Account",
            "Race Registration Site",
            "Onsite or Remote",
            "Event & Point Name",
            "Crew",
            "Start/Split/Finish",
            "Event Distance(s)/Start Time(s)",
            "Awards and Age Groups per Event",
            "Additional Scoring/Support Expectations",
            "Post-Event Expectations",
          ].map((field) => [field, filled(events, field)]),
        ),
      },
      tasks: {
        statuses: frequencies(tasks, "Status"),
        related_to_pipeline: tasks.filter((record) =>
          pipelineIds.has(record["Related To.id"]),
        ).length,
        broken_related_links: tasks.filter(
          (record) =>
            text(record["Related To.id"]) &&
            !pipelineIds.has(record["Related To.id"]),
        ).length,
      },
    },
    null,
    2,
  ),
);
