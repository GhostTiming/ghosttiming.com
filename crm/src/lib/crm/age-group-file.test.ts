import { describe, expect, it } from "vitest";
import {
  ageBandFromFileRow,
  ageBandsForFileEvent,
  exportAgeGroupFile,
  fileGendersFromBand,
  formatAgeGroupFileName,
  formatAgeGroupFileShortName,
  parseAgeGroupFile,
  scoringWithImportedAgeGroups,
  suggestAgeGroupEventMappings,
} from "./age-group-file";

const milesToGoFile = {
  ageGroups: {
    "133": [
      { genders: ["F"], min_age: 1, max_age: 12, name: "Female 12 and Under", short_name: "F0112", num_winners: 3, scored_event_id: 133, is_overall_gender_division: false },
      { genders: ["F"], min_age: 13, max_age: 17, name: "Female 13 - 17", short_name: "F1317", num_winners: 3, scored_event_id: 133, is_overall_gender_division: false },
      { genders: ["F"], min_age: 18, max_age: 59, name: "Female 18 - 59", short_name: "F1859", num_winners: 3, scored_event_id: 133, is_overall_gender_division: false },
      { genders: ["F"], min_age: 60, max_age: 99, name: "Female 60 and Over", short_name: "F6099", num_winners: 3, scored_event_id: 133, is_overall_gender_division: false },
      { genders: ["M"], min_age: 1, max_age: 12, name: "Male 12 and Under", short_name: "M0112", num_winners: 3, scored_event_id: 133, is_overall_gender_division: false },
      { genders: ["M"], min_age: 13, max_age: 17, name: "Male 13 - 17", short_name: "M1317", num_winners: 3, scored_event_id: 133, is_overall_gender_division: false },
      { genders: ["M"], min_age: 18, max_age: 59, name: "Male 18 - 59", short_name: "M1859", num_winners: 3, scored_event_id: 133, is_overall_gender_division: false },
      { genders: ["M"], min_age: 60, max_age: 99, name: "Male 60 and Over", short_name: "M6099", num_winners: 3, scored_event_id: 133, is_overall_gender_division: false },
      { genders: ["X"], min_age: 1, max_age: 1, name: "Non-Binary 1 - 1", short_name: "X0101", num_winners: 0, scored_event_id: 133, is_overall_gender_division: false },
      { genders: ["F", "M", "X"], min_age: 0, max_age: 0, name: "Contact Timer", short_name: "0000", num_winners: 0, scored_event_id: 133, is_overall_gender_division: false },
    ],
  },
  scoredEvents: [{ scored_event_id: 133, scored_event_name: "Miles To Go 5K Run/Walk" }],
};

describe("age group file names", () => {
  it("matches the scoring-software short names and labels", () => {
    expect(formatAgeGroupFileShortName(["F"], 1, 12)).toBe("F0112");
    expect(formatAgeGroupFileShortName(["M"], 60, 99)).toBe("M6099");
    expect(formatAgeGroupFileShortName(["X"], 1, 1)).toBe("X0101");
    expect(formatAgeGroupFileShortName(["F", "M", "X"], 0, 0)).toBe("0000");
    expect(formatAgeGroupFileName(["F"], 1, 12)).toBe("Female 12 and Under");
    expect(formatAgeGroupFileName(["F"], 13, 17)).toBe("Female 13 - 17");
    expect(formatAgeGroupFileName(["M"], 60, 99)).toBe("Male 60 and Over");
    expect(formatAgeGroupFileName(["X"], 1, 1)).toBe("Non-Binary 1 - 1");
    expect(formatAgeGroupFileName(["F", "M", "X"], 0, 0)).toBe("Contact Timer");
  });
});

describe("import", () => {
  it("reads a multi-event AgeGroups.json and keeps their ages and winners", () => {
    const file = parseAgeGroupFile(milesToGoFile);
    expect(file.scoredEvents).toEqual([
      { scored_event_id: 133, scored_event_name: "Miles To Go 5K Run/Walk" },
    ]);
    const bands = ageBandsForFileEvent(file, 133);
    expect(bands).toHaveLength(10);
    expect(bands[0]).toEqual({
      genders: ["female"],
      minAge: 1,
      maxAge: 12,
      awardDepth: 3,
    });
    expect(bands[7]).toEqual({
      genders: ["male"],
      minAge: 60,
      maxAge: 99,
      awardDepth: 3,
    });
    expect(bands[8]).toEqual({
      genders: ["non_binary"],
      minAge: 1,
      maxAge: 1,
      awardDepth: null,
    });
    expect(bands[9]).toEqual({
      genders: ["combined"],
      minAge: 0,
      maxAge: 0,
      awardDepth: null,
    });
  });

  it("auto-maps a file event onto a same-named CRM race", () => {
    const file = parseAgeGroupFile(milesToGoFile);
    expect(
      suggestAgeGroupEventMappings(file, [
        { id: "race-10k", name: "10K" },
        { id: "race-5k", name: "Miles To Go 5K Run/Walk" },
      ]),
    ).toEqual({ "133": "race-5k" });
  });

  it("keeps existing awards when replacing age groups", () => {
    expect(
      scoringWithImportedAgeGroups(
        {
          ageGroups: [{ genders: ["male"], minAge: 20, maxAge: 24, awardDepth: 1 }],
          awards: [{ title: "Overall", genders: ["male", "female"], minAge: null, maxAge: null }],
          notes: "Keep me",
        },
        [{ genders: ["female"], minAge: 1, maxAge: 12, awardDepth: 3 }],
      ),
    ).toEqual({
      ageGroups: [
        { genders: ["female"], minAge: 1, maxAge: 12, awardDepth: 3 },
        { genders: ["combined"], minAge: 0, maxAge: 0, awardDepth: null },
      ],
      awards: [{ title: "Overall", genders: ["male", "female"], minAge: null, maxAge: null }],
      notes: "Keep me",
    });
  });

  it("rejects files that are not Age Groups exports", () => {
    expect(() => parseAgeGroupFile([])).toThrow("not an Age Groups export");
    expect(() => parseAgeGroupFile({ scoredEvents: [] })).toThrow(
      "no events to import",
    );
  });
});

describe("export", () => {
  it("expands CRM genders into one scoring-software row per gender", () => {
    expect(fileGendersFromBand(["male", "female"])).toEqual(["F", "M"]);
    const file = exportAgeGroupFile([
      {
        id: "race-5k",
        name: "Miles To Go 5K Run/Walk",
        scoring: {
          ageGroups: [
            { genders: ["female"], minAge: 1, maxAge: 12, awardDepth: 3 },
            { genders: ["male"], minAge: 60, maxAge: null, awardDepth: 3 },
            { genders: ["combined"], minAge: 0, maxAge: 0, awardDepth: null },
          ],
          awards: [],
          notes: null,
        },
      },
    ]);
    expect(file.scoredEvents[0]).toEqual({
      scored_event_id: 1,
      scored_event_name: "Miles To Go 5K Run/Walk",
    });
    const exported = exportAgeGroupFile([
      {
        id: "race-5k",
        name: "5K",
        scoring: {
          ageGroups: [{ genders: ["female"], minAge: 1, maxAge: 12, awardDepth: 3 }],
          awards: [],
          notes: null,
        },
      },
    ]);
    expect(exported.ageGroups["1"].at(-1)).toMatchObject({
      name: "Contact Timer",
      short_name: "0000",
      genders: ["F", "M", "X"],
      min_age: 0,
      max_age: 0,
      num_winners: 0,
    });
    expect(file.ageGroups["1"].map((row) => row.short_name)).toEqual([
      "F0112",
      "M6099",
      "0000",
    ]);
    expect(ageBandFromFileRow(file.ageGroups["1"][1])).toEqual({
      genders: ["male"],
      minAge: 60,
      maxAge: 99,
      awardDepth: 3,
    });
  });
});
