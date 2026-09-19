import { describe, expect, it } from "vitest";
import {
  buildAgeBandSeries,
  copyAwardDepthToOtherBands,
  formatAgeBand,
  formatAgeGroupsField,
  formatAgeRange,
  formatAwardRule,
  formatAwardsField,
  formatListGenderCodes,
  scoringFromLegacyText,
  serializeRaceScoring,
  toggleRaceGender,
  withContactTimerAgeGroup,
} from "./race-scoring";

describe("age range copy", () => {
  it("treats 0 or 1 as and under", () => {
    expect(formatAgeRange(0, 13)).toBe("13 and under");
    expect(formatAgeRange(1, 12)).toBe("12 and under");
    expect(formatAgeRange(null, 13)).toBe("13 and under");
  });

  it("prints open-ended max, including 99, as and over", () => {
    expect(formatAgeRange(80, null)).toBe("80 and over");
    expect(formatAgeRange(60, 99)).toBe("60 and over");
  });

  it("does not treat a zero min with no max as 0 and over", () => {
    expect(formatAgeRange(0, null)).toBe("");
  });

  it("prints inclusive spans with an en dash", () => {
    expect(formatAgeRange(14, 16)).toBe("14–16");
    expect(formatAgeRange(20, 24)).toBe("20–24");
    expect(formatAgeRange(1, 1)).toBe("1");
  });
});

describe("gender chips", () => {
  it("lets male and female sit on the same row", () => {
    expect(toggleRaceGender(["male"], "female")).toEqual(["male", "female"]);
  });

  it("makes combined exclusive", () => {
    expect(toggleRaceGender(["male", "female"], "combined")).toEqual(["combined"]);
    expect(toggleRaceGender(["combined"], "male")).toEqual(["male"]);
  });
});

describe("display lines", () => {
  it("formats a typical youth band", () => {
    expect(
      formatAgeBand({
        genders: ["male", "female"],
        minAge: 0,
        maxAge: 13,
        awardDepth: null,
      }),
    ).toBe("Male, Female · 13 and under");
    expect(
      formatAgeBand({
        genders: ["female"],
        minAge: 1,
        maxAge: 12,
        awardDepth: 3,
      }),
    ).toBe("Female · 12 and under · Top 3");
    expect(
      formatAgeBand({
        genders: ["male"],
        minAge: 60,
        maxAge: 99,
        awardDepth: 3,
      }),
    ).toBe("Male · 60 and over · Top 3");
    expect(
      formatAgeBand({
        genders: ["combined"],
        minAge: 0,
        maxAge: 0,
        awardDepth: null,
      }),
    ).toBe("All · Contact Timer");
  });

  it("includes awards depth on the age group line", () => {
    expect(
      formatAgeBand({
        genders: ["male", "female"],
        minAge: 0,
        maxAge: 13,
        awardDepth: 3,
      }),
    ).toBe("Male, Female · 13 and under · Top 3");
  });

  it("formats overall and masters awards", () => {
    expect(
      formatAwardRule({
        title: "Overall",
        genders: ["male", "female"],
        minAge: null,
        maxAge: null,
      }),
    ).toBe("Overall · Male, Female");
    expect(
      formatAwardRule({
        title: "Masters",
        genders: ["male", "female"],
        minAge: 40,
        maxAge: null,
      }),
    ).toBe("Masters (40 and over) · Male, Female");
  });
});

describe("bulk series", () => {
  it("builds 5-year bands through 79 and leaves 80+ to add by hand", () => {
    expect(
      buildAgeBandSeries({
        genders: ["male", "female"],
        start: 25,
        span: 5,
        lastHigh: 79,
      }),
    ).toEqual([
      { genders: ["male", "female"], minAge: 25, maxAge: 29, awardDepth: null },
      { genders: ["male", "female"], minAge: 30, maxAge: 34, awardDepth: null },
      { genders: ["male", "female"], minAge: 35, maxAge: 39, awardDepth: null },
      { genders: ["male", "female"], minAge: 40, maxAge: 44, awardDepth: null },
      { genders: ["male", "female"], minAge: 45, maxAge: 49, awardDepth: null },
      { genders: ["male", "female"], minAge: 50, maxAge: 54, awardDepth: null },
      { genders: ["male", "female"], minAge: 55, maxAge: 59, awardDepth: null },
      { genders: ["male", "female"], minAge: 60, maxAge: 64, awardDepth: null },
      { genders: ["male", "female"], minAge: 65, maxAge: 69, awardDepth: null },
      { genders: ["male", "female"], minAge: 70, maxAge: 74, awardDepth: null },
      { genders: ["male", "female"], minAge: 75, maxAge: 79, awardDepth: null },
    ]);
  });

  it("appends after irregular early bands", () => {
    const early = [
      { genders: ["male", "female"] as const, minAge: 0, maxAge: 13, awardDepth: 3 },
      { genders: ["male", "female"] as const, minAge: 14, maxAge: 16, awardDepth: 3 },
      { genders: ["male", "female"] as const, minAge: 17, maxAge: 19, awardDepth: 3 },
      { genders: ["male", "female"] as const, minAge: 20, maxAge: 24, awardDepth: 3 },
    ];
    const generated = buildAgeBandSeries({
      genders: ["male", "female"],
      start: 25,
      span: 5,
      lastHigh: 79,
    });
    expect([...early, ...generated][0]).toEqual(early[0]);
    expect([...early, ...generated].at(-1)).toEqual({
      genders: ["male", "female"],
      minAge: 75,
      maxAge: 79,
      awardDepth: null,
    });
    expect([...early, ...generated]).toHaveLength(15);
  });

  it("can carry awards depth onto the generated bands", () => {
    expect(
      buildAgeBandSeries({
        genders: ["male", "female"],
        start: 25,
        span: 5,
        lastHigh: 29,
        awardDepth: 3,
      }),
    ).toEqual([{ genders: ["male", "female"], minAge: 25, maxAge: 29, awardDepth: 3 }]);
  });
});

describe("awards depth", () => {
  it("copies one age group's depth onto the rest", () => {
    expect(
      copyAwardDepthToOtherBands(
        [
          { genders: ["male", "female"], minAge: 0, maxAge: 13, awardDepth: 3 },
          { genders: ["male", "female"], minAge: 14, maxAge: 16, awardDepth: null },
          { genders: ["male", "female"], minAge: 80, maxAge: null, awardDepth: 1 },
        ],
        0,
      ),
    ).toEqual([
      { genders: ["male", "female"], minAge: 0, maxAge: 13, awardDepth: 3 },
      { genders: ["male", "female"], minAge: 14, maxAge: 16, awardDepth: 3 },
      { genders: ["male", "female"], minAge: 80, maxAge: null, awardDepth: 3 },
    ]);
  });
});

describe("legacy text", () => {
  it("moves old pasted copy into notes when nothing structured exists", () => {
    expect(
      scoringFromLegacyText({
        ageGroups: "Overall\n0-9",
        awards: "Overall M/F",
      }),
    ).toEqual({
      ageGroups: withContactTimerAgeGroup([]),
      awards: [],
      notes: "Overall\n0-9\n\nOverall M/F",
    });
  });

  it("keeps structured scoring when present and appends Contact Timer", () => {
    const scoring = scoringFromLegacyText({
      scoring: {
        ageGroups: [{ genders: ["male"], minAge: 20, maxAge: 24 }],
        awards: [],
        notes: null,
      },
      ageGroups: "old paste",
    });
    expect(scoring.ageGroups).toEqual([
      { genders: ["male"], minAge: 20, maxAge: 24, awardDepth: null },
      ...withContactTimerAgeGroup([]),
    ]);
    expect(scoring.notes).toBeNull();
  });

  it("keeps Contact Timer on serialize even when the editor omitted it", () => {
    expect(
      serializeRaceScoring({
        ageGroups: [{ genders: ["female"], minAge: 1, maxAge: 12, awardDepth: 3 }],
        awards: [],
        notes: null,
      }).ageGroups.at(-1),
    ).toEqual({
      genders: ["combined"],
      minAge: 0,
      maxAge: 0,
      awardDepth: null,
    });
  });

  it("keeps max age 99 and fills blank open-ended max as 99", () => {
    expect(
      serializeRaceScoring({
        ageGroups: [{ genders: ["male"], minAge: 60, maxAge: 99, awardDepth: 3 }],
        awards: [],
        notes: null,
      }).ageGroups[0],
    ).toEqual({
      genders: ["male"],
      minAge: 60,
      maxAge: 99,
      awardDepth: 3,
    });
    expect(
      serializeRaceScoring({
        ageGroups: [{ genders: ["male"], minAge: 90, maxAge: null, awardDepth: 3 }],
        awards: [],
        notes: null,
      }).ageGroups[0]?.maxAge,
    ).toBe(99);
  });
});

describe("field snapshots", () => {
  it("collapses matching gender bands onto one F/M or F/M/X line", () => {
    expect(formatListGenderCodes(["male", "female"])).toBe("F/M");
    expect(formatListGenderCodes(["combined"])).toBe("F/M/X");
    expect(formatListGenderCodes(["female", "male", "non_binary"])).toBe("F/M/X");
    expect(
      formatAgeGroupsField([
        { genders: ["female"], minAge: 11, maxAge: 14, awardDepth: 3 },
        { genders: ["male"], minAge: 11, maxAge: 14, awardDepth: 3 },
      ]),
    ).toBe("F/M · 11–14 · Top 3");
    expect(
      formatAgeGroupsField([
        { genders: ["female"], minAge: 11, maxAge: 14, awardDepth: 3 },
        { genders: ["male"], minAge: 11, maxAge: 14, awardDepth: 3 },
        { genders: ["non_binary"], minAge: 11, maxAge: 14, awardDepth: 3 },
      ]),
    ).toBe("F/M/X · 11–14 · Top 3");
    expect(
      formatAgeGroupsField([
        { genders: ["combined"], minAge: 11, maxAge: 14, awardDepth: 3 },
      ]),
    ).toBe("F/M/X · 11–14 · Top 3");
    expect(
      formatAgeGroupsField([
        { genders: ["male", "female"], minAge: 0, maxAge: 13, awardDepth: 3 },
        { genders: ["male", "female"], minAge: 14, maxAge: 16, awardDepth: 3 },
      ]),
    ).toBe("F/M · 13 and under · Top 3\nF/M · 14–16 · Top 3");
    expect(
      formatAwardsField([
        {
          title: "Overall",
          genders: ["male"],
          minAge: null,
          maxAge: null,
        },
        {
          title: "Overall",
          genders: ["female"],
          minAge: null,
          maxAge: null,
        },
      ]),
    ).toBe("Overall · F/M");
  });
});
