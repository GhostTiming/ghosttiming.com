export const RACE_GENDERS = ["male", "female", "non_binary", "combined"] as const;

export type RaceGender = (typeof RACE_GENDERS)[number];

export const RACE_GENDER_LABELS: Record<RaceGender, string> = {
  male: "Male",
  female: "Female",
  non_binary: "Non-binary",
  combined: "Combined",
};

export type AgeBand = {
  genders: RaceGender[];
  minAge: number | null;
  maxAge: number | null;
  awardDepth: number | null;
};

export type AwardRule = {
  title: string;
  genders: RaceGender[];
  minAge: number | null;
  maxAge: number | null;
};

export type RaceScoring = {
  ageGroups: AgeBand[];
  awards: AwardRule[];
  notes: string | null;
};

const GENDER_ORDER: RaceGender[] = [
  "male",
  "female",
  "non_binary",
  "combined",
];

function isRaceGender(value: unknown): value is RaceGender {
  return RACE_GENDERS.includes(value as RaceGender);
}

function uniqueGenders(genders: RaceGender[]) {
  const unique = [...new Set(genders)];
  if (unique.includes("combined")) return ["combined"] as RaceGender[];
  return GENDER_ORDER.filter((gender) => unique.includes(gender));
}

export function emptyRaceScoring(): RaceScoring {
  return { ageGroups: [], awards: [], notes: null };
}

export function hasStructuredScoring(scoring: RaceScoring) {
  return scoring.ageGroups.length > 0 || scoring.awards.length > 0;
}

export function toggleRaceGender(current: RaceGender[], gender: RaceGender): RaceGender[] {
  if (gender === "combined") {
    return current.length === 1 && current[0] === "combined" ? [] : ["combined"];
  }
  const withoutCombined = current.filter((item) => item !== "combined");
  if (withoutCombined.includes(gender)) {
    return uniqueGenders(withoutCombined.filter((item) => item !== gender));
  }
  return uniqueGenders([...withoutCombined, gender]);
}

export function formatAgeRange(minAge: number | null, maxAge: number | null) {
  if (maxAge != null && (minAge == null || minAge === 0)) {
    return `${maxAge} and under`;
  }
  if (minAge != null && minAge > 0 && maxAge == null) {
    return `${minAge} and over`;
  }
  if (minAge != null && maxAge != null) {
    return minAge === maxAge ? `${minAge}` : `${minAge}–${maxAge}`;
  }
  return "";
}

export function formatGenderList(genders: RaceGender[]) {
  return uniqueGenders(genders)
    .map((gender) => RACE_GENDER_LABELS[gender])
    .join(", ");
}

function withGenders(genders: RaceGender[], detail: string) {
  const labels = formatGenderList(genders);
  if (!labels) return detail;
  return detail ? `${labels} · ${detail}` : labels;
}

export function formatAwardDepth(depth: number | null | undefined) {
  if (depth == null || depth < 1) return "";
  return `Top ${depth}`;
}

export function formatAgeBand(band: AgeBand) {
  const detail = [formatAgeRange(band.minAge, band.maxAge), formatAwardDepth(band.awardDepth)]
    .filter(Boolean)
    .join(" · ");
  return withGenders(band.genders, detail);
}

export function formatAwardRule(award: AwardRule) {
  const title = award.title.trim();
  const range = formatAgeRange(award.minAge, award.maxAge);
  const headed = range ? `${title} (${range})` : title;
  const labels = formatGenderList(award.genders);
  if (!labels) return headed;
  return headed ? `${headed} · ${labels}` : labels;
}

export function formatAgeGroupsField(bands: AgeBand[]) {
  const lines = bands.map(formatAgeBand).filter(Boolean);
  return lines.length ? lines.join("\n") : null;
}

export function formatAwardsField(awards: AwardRule[]) {
  const lines = awards.map(formatAwardRule).filter(Boolean);
  return lines.length ? lines.join("\n") : null;
}

export function buildAgeBandSeries(input: {
  genders: RaceGender[];
  start: number;
  span: number;
  lastHigh: number;
  awardDepth?: number | null;
}): AgeBand[] {
  const genders = uniqueGenders(input.genders);
  if (!genders.length) throw new Error("Pick at least one gender.");
  if (!Number.isInteger(input.start) || input.start < 0) {
    throw new Error("Start age must be 0 or higher.");
  }
  if (!Number.isInteger(input.span) || input.span < 1) {
    throw new Error("Span must be at least 1 year.");
  }
  if (!Number.isInteger(input.lastHigh) || input.lastHigh < input.start) {
    throw new Error("Last age must be at or above the start age.");
  }
  const awardDepth = asPositiveIntOrNull(input.awardDepth);
  const bands: AgeBand[] = [];
  let minAge = input.start;
  while (minAge <= input.lastHigh) {
    const maxAge = Math.min(minAge + input.span - 1, input.lastHigh);
    bands.push({ genders, minAge, maxAge, awardDepth });
    minAge = maxAge + 1;
  }
  return bands;
}

export function copyAwardDepthToOtherBands(bands: AgeBand[], fromIndex: number): AgeBand[] {
  const source = bands[fromIndex];
  if (!source) return bands;
  return bands.map((band, index) =>
    index === fromIndex ? band : { ...band, awardDepth: source.awardDepth },
  );
}

function asIntOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(number) || number < 0) return null;
  return number;
}

function asPositiveIntOrNull(value: unknown): number | null {
  const number = asIntOrNull(value);
  return number != null && number >= 1 ? number : null;
}

function parseGenders(value: unknown): RaceGender[] {
  if (!Array.isArray(value)) return [];
  return uniqueGenders(value.filter(isRaceGender));
}

function parseAgeBand(value: unknown): AgeBand | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const genders = parseGenders(row.genders);
  if (!genders.length) return null;
  const minAge = asIntOrNull(row.minAge);
  const maxAge = asIntOrNull(row.maxAge);
  if (minAge != null && maxAge != null && minAge > maxAge) return null;
  return {
    genders,
    minAge,
    maxAge,
    awardDepth: asPositiveIntOrNull(row.awardDepth),
  };
}

function parseAwardRule(value: unknown): AwardRule | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const title = typeof row.title === "string" ? row.title.trim() : "";
  if (!title) return null;
  const genders = parseGenders(row.genders);
  if (!genders.length) return null;
  const minAge = asIntOrNull(row.minAge);
  const maxAge = asIntOrNull(row.maxAge);
  if (minAge != null && maxAge != null && minAge > maxAge) return null;
  return { title, genders, minAge, maxAge };
}

export function parseRaceScoring(value: unknown): RaceScoring {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return emptyRaceScoring();
  }
  const row = value as Record<string, unknown>;
  const notes =
    typeof row.notes === "string" && row.notes.trim() ? row.notes.trim() : null;
  return {
    ageGroups: Array.isArray(row.ageGroups)
      ? row.ageGroups.flatMap((item) => {
          const band = parseAgeBand(item);
          return band ? [band] : [];
        })
      : [],
    awards: Array.isArray(row.awards)
      ? row.awards.flatMap((item) => {
          const award = parseAwardRule(item);
          return award ? [award] : [];
        })
      : [],
    notes,
  };
}

export function scoringFromLegacyText(input: {
  scoring?: unknown;
  ageGroups?: string | null;
  awards?: string | null;
}): RaceScoring {
  const scoring = parseRaceScoring(input.scoring);
  if (hasStructuredScoring(scoring) || scoring.notes) return scoring;
  const leftover = [input.ageGroups, input.awards]
    .map((value) => (value ?? "").trim())
    .filter(Boolean)
    .join("\n\n");
  return { ...scoring, notes: leftover || null };
}

export function serializeRaceScoring(scoring: RaceScoring): RaceScoring {
  const notes = scoring.notes?.trim() || null;
  return {
    ageGroups: scoring.ageGroups
      .map((band) => parseAgeBand(band))
      .filter((band): band is AgeBand => Boolean(band)),
    awards: scoring.awards
      .map((award) => parseAwardRule(award))
      .filter((award): award is AwardRule => Boolean(award)),
    notes,
  };
}
