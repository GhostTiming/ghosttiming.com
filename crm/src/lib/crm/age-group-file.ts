import {
  parseRaceScoring,
  scoringFromLegacyText,
  serializeRaceScoring,
  type AgeBand,
  type RaceGender,
  type RaceScoring,
} from "./race-scoring";

export const AGE_GROUP_FILE_GENDERS = ["F", "M", "X"] as const;
export type AgeGroupFileGender = (typeof AGE_GROUP_FILE_GENDERS)[number];

export type AgeGroupFileRow = {
  age_group_id: number;
  rdgo_race_id: number;
  scored_event_id: number;
  genders: AgeGroupFileGender[];
  min_age: number;
  max_age: number;
  name: string;
  short_name: string;
  num_winners: number;
  age_group_sequence: number;
  is_overall_gender_division: boolean;
};

export type AgeGroupFileEvent = {
  scored_event_id: number;
  scored_event_name: string;
};

export type AgeGroupFile = {
  ageGroups: Record<string, AgeGroupFileRow[]>;
  scoredEvents: AgeGroupFileEvent[];
};

export type AgeGroupFileRace = {
  id: string;
  name: string;
  scoring?: unknown;
  ageGroups?: string | null;
  awards?: string | null;
};

const GENDER_FROM_FILE: Record<AgeGroupFileGender, RaceGender> = {
  F: "female",
  M: "male",
  X: "non_binary",
};

const GENDER_TO_FILE: Record<Exclude<RaceGender, "combined">, AgeGroupFileGender> = {
  female: "F",
  male: "M",
  non_binary: "X",
};

const FILE_GENDER_LABEL: Record<AgeGroupFileGender, string> = {
  F: "Female",
  M: "Male",
  X: "Non-Binary",
};

function asInt(value: unknown, fallback = 0) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function normalizeEventName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function padAge(value: number) {
  return String(Math.max(0, value)).padStart(2, "0").slice(-2);
}

function isFileGender(value: unknown): value is AgeGroupFileGender {
  return AGE_GROUP_FILE_GENDERS.includes(value as AgeGroupFileGender);
}

function uniqueFileGenders(genders: AgeGroupFileGender[]) {
  return AGE_GROUP_FILE_GENDERS.filter((gender) => genders.includes(gender));
}

export function fileGendersFromBand(genders: RaceGender[]): AgeGroupFileGender[] {
  if (genders.includes("combined")) return [...AGE_GROUP_FILE_GENDERS];
  return uniqueFileGenders(
    genders.flatMap((gender) =>
      gender === "combined" ? [] : [GENDER_TO_FILE[gender]],
    ),
  );
}

export function bandGendersFromFile(genders: AgeGroupFileGender[]): RaceGender[] {
  const unique = uniqueFileGenders(genders);
  if (unique.length === AGE_GROUP_FILE_GENDERS.length) return ["combined"];
  return unique.map((gender) => GENDER_FROM_FILE[gender]);
}

export function formatAgeGroupFileName(
  genders: AgeGroupFileGender[],
  minAge: number,
  maxAge: number,
) {
  if (genders.length > 1 && minAge === 0 && maxAge === 0) return "Contact Timer";
  const label =
    genders.length === 1 ? FILE_GENDER_LABEL[genders[0]] : "All";
  if (maxAge >= 99) return `${label} ${minAge} and Over`;
  if (minAge <= 1 && minAge !== maxAge) return `${label} ${maxAge} and Under`;
  return `${label} ${minAge} - ${maxAge}`;
}

export function formatAgeGroupFileShortName(
  genders: AgeGroupFileGender[],
  minAge: number,
  maxAge: number,
) {
  const ages = `${padAge(minAge)}${padAge(maxAge)}`;
  if (genders.length !== 1) return ages;
  return `${genders[0]}${ages}`;
}

export function ageBandFromFileRow(row: AgeGroupFileRow): AgeBand | null {
  const genders = bandGendersFromFile(row.genders);
  if (!genders.length) return null;
  const minAge = asInt(row.min_age);
  const maxAge = asInt(row.max_age);
  if (minAge < 0 || maxAge < 0 || minAge > maxAge) return null;
  const winners = asInt(row.num_winners);
  return {
    genders,
    minAge,
    maxAge,
    awardDepth: winners >= 1 ? winners : null,
  };
}

export function fileRowsFromAgeBands(
  bands: AgeBand[],
  scoredEventId: number,
  rdgoRaceId = 1,
): AgeGroupFileRow[] {
  const rows: AgeGroupFileRow[] = [];
  let sequence = 0;
  let ageGroupId = scoredEventId * 1000;
  for (const band of bands) {
    const codes = fileGendersFromBand(band.genders);
    if (!codes.length) continue;
    const expanded =
      codes.length === AGE_GROUP_FILE_GENDERS.length
        ? [codes]
        : codes.map((code) => [code]);
    for (const genders of expanded) {
      const minAge = band.minAge ?? 0;
      const maxAge = band.maxAge ?? 99;
      rows.push({
        age_group_id: ageGroupId,
        rdgo_race_id: rdgoRaceId,
        scored_event_id: scoredEventId,
        genders,
        min_age: minAge,
        max_age: maxAge,
        name: formatAgeGroupFileName(genders, minAge, maxAge),
        short_name: formatAgeGroupFileShortName(genders, minAge, maxAge),
        num_winners: band.awardDepth ?? 0,
        age_group_sequence: sequence,
        is_overall_gender_division: false,
      });
      ageGroupId += 1;
      sequence += 1;
    }
  }
  return rows;
}

function parseFileRow(value: unknown, scoredEventId: number): AgeGroupFileRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const genders = Array.isArray(row.genders)
    ? uniqueFileGenders(row.genders.filter(isFileGender))
    : [];
  if (!genders.length) return null;
  const minAge = asInt(row.min_age);
  const maxAge = asInt(row.max_age);
  if (minAge < 0 || maxAge < 0 || minAge > maxAge) return null;
  return {
    age_group_id: asInt(row.age_group_id),
    rdgo_race_id: asInt(row.rdgo_race_id),
    scored_event_id: asInt(row.scored_event_id, scoredEventId),
    genders,
    min_age: minAge,
    max_age: maxAge,
    name: typeof row.name === "string" ? row.name : "",
    short_name: typeof row.short_name === "string" ? row.short_name : "",
    num_winners: Math.max(0, asInt(row.num_winners)),
    age_group_sequence: asInt(row.age_group_sequence),
    is_overall_gender_division: row.is_overall_gender_division === true,
  };
}

export function parseAgeGroupFile(value: unknown): AgeGroupFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("That file is not an Age Groups export.");
  }
  const row = value as Record<string, unknown>;
  const rawGroups = row.ageGroups;
  if (!rawGroups || typeof rawGroups !== "object" || Array.isArray(rawGroups)) {
    throw new Error("That Age Groups file has no events to import.");
  }

  const ageGroups: Record<string, AgeGroupFileRow[]> = {};
  for (const [key, groups] of Object.entries(rawGroups)) {
    const scoredEventId = asInt(key);
    if (!Array.isArray(groups)) continue;
    const parsed = groups.flatMap((item) => {
      const group = parseFileRow(item, scoredEventId);
      return group ? [group] : [];
    });
    if (parsed.length) ageGroups[String(scoredEventId)] = parsed;
  }
  if (!Object.keys(ageGroups).length) {
    throw new Error("That Age Groups file has no age groups to import.");
  }

  const namedEvents = Array.isArray(row.scoredEvents)
    ? row.scoredEvents.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const event = item as Record<string, unknown>;
        const scoredEventId = asInt(event.scored_event_id);
        if (!ageGroups[String(scoredEventId)]) return [];
        const name =
          typeof event.scored_event_name === "string"
            ? event.scored_event_name.trim()
            : "";
        return [
          {
            scored_event_id: scoredEventId,
            scored_event_name: name || `Event ${scoredEventId}`,
          },
        ];
      })
    : [];

  const scoredEvents = Object.keys(ageGroups).map((key) => {
    const scoredEventId = asInt(key);
    return (
      namedEvents.find((event) => event.scored_event_id === scoredEventId) ?? {
        scored_event_id: scoredEventId,
        scored_event_name: `Event ${scoredEventId}`,
      }
    );
  });

  return { ageGroups, scoredEvents };
}

export function scoringForRace(race: AgeGroupFileRace): RaceScoring {
  return scoringFromLegacyText({
    scoring: race.scoring,
    ageGroups: race.ageGroups,
    awards: race.awards,
  });
}

export function exportAgeGroupFile(races: readonly AgeGroupFileRace[]): AgeGroupFile {
  const ageGroups: Record<string, AgeGroupFileRow[]> = {};
  const scoredEvents: AgeGroupFileEvent[] = races.map((race, index) => {
    const scoredEventId = index + 1;
    const scoring = scoringForRace(race);
    ageGroups[String(scoredEventId)] = fileRowsFromAgeBands(
      scoring.ageGroups,
      scoredEventId,
    );
    return {
      scored_event_id: scoredEventId,
      scored_event_name: race.name,
    };
  });
  return { ageGroups, scoredEvents };
}

export function ageBandsForFileEvent(file: AgeGroupFile, scoredEventId: number) {
  return (file.ageGroups[String(scoredEventId)] ?? [])
    .filter((row) => !row.is_overall_gender_division)
    .flatMap((row) => {
      const band = ageBandFromFileRow(row);
      return band ? [band] : [];
    });
}

export function suggestAgeGroupEventMappings(
  file: AgeGroupFile,
  races: readonly AgeGroupFileRace[],
): Record<string, string> {
  const unused = [...races];
  const mappings: Record<string, string> = {};
  for (const event of file.scoredEvents) {
    const needle = normalizeEventName(event.scored_event_name);
    const index = unused.findIndex(
      (race) => normalizeEventName(race.name) === needle,
    );
    if (index >= 0) {
      mappings[String(event.scored_event_id)] = unused[index].id;
      unused.splice(index, 1);
    }
  }
  if (
    file.scoredEvents.length === 1 &&
    races.length === 1 &&
    !mappings[String(file.scoredEvents[0].scored_event_id)]
  ) {
    mappings[String(file.scoredEvents[0].scored_event_id)] = races[0].id;
  }
  return mappings;
}

export function scoringWithImportedAgeGroups(
  current: unknown,
  ageGroups: AgeBand[],
): RaceScoring {
  const scoring = parseRaceScoring(current);
  return serializeRaceScoring({
    ...scoring,
    ageGroups,
  });
}
