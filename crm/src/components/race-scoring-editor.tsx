"use client";

import { useMemo, useState } from "react";
import { CollapsibleCard } from "@/components/collapsible-card";
import {
  buildAgeBandSeries,
  copyAwardDepthToOtherBands,
  formatAgeBand,
  formatAwardRule,
  RACE_GENDER_LABELS,
  RACE_GENDERS,
  scoringFromLegacyText,
  serializeRaceScoring,
  toggleRaceGender,
  type AgeBand,
  type AwardRule,
  type RaceGender,
  type RaceScoring,
} from "@/lib/crm/race-scoring";

function GenderChips({
  value,
  onChange,
}: {
  value: RaceGender[];
  onChange: (next: RaceGender[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {RACE_GENDERS.map((gender) => {
        const selected = value.includes(gender);
        return (
          <button
            key={gender}
            type="button"
            onClick={() => onChange(toggleRaceGender(value, gender))}
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
              selected
                ? "bg-cyan-700 text-white"
                : "border border-slate-300 bg-white text-slate-700 hover:border-cyan-600"
            }`}
          >
            {RACE_GENDER_LABELS[gender]}
          </button>
        );
      })}
    </div>
  );
}

function AgeInput({
  label,
  value,
  onChange,
  min = 0,
}: {
  label: string;
  value: number | null;
  onChange: (next: number | null) => void;
  min?: number;
}) {
  return (
    <label className="text-xs text-slate-600">
      {label}
      <input
        type="number"
        min={min}
        inputMode="numeric"
        value={value ?? ""}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === "") {
            onChange(null);
            return;
          }
          const next = Number(raw);
          onChange(Number.isInteger(next) && next >= min ? next : null);
        }}
        className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
      />
    </label>
  );
}

const defaultGenders: RaceGender[] = ["male", "female"];

function emptyAgeBand(): AgeBand {
  return { genders: defaultGenders, minAge: 0, maxAge: null, awardDepth: null };
}

function emptyAward(): AwardRule {
  return { title: "", genders: defaultGenders, minAge: null, maxAge: null };
}

export function RaceScoringEditor({
  scoring,
  legacyAgeGroups,
  legacyAwards,
}: {
  scoring?: unknown;
  legacyAgeGroups?: string | null;
  legacyAwards?: string | null;
}) {
  const initial = useMemo(
    () =>
      scoringFromLegacyText({
        scoring,
        ageGroups: legacyAgeGroups,
        awards: legacyAwards,
      }),
    [scoring, legacyAgeGroups, legacyAwards],
  );
  const [state, setState] = useState<RaceScoring>(initial);
  const [series, setSeries] = useState({
    genders: defaultGenders,
    start: "25",
    span: "5",
    lastHigh: "79",
  });
  const [seriesError, setSeriesError] = useState<string | null>(null);

  function update(patch: Partial<RaceScoring>) {
    setState((current) => ({ ...current, ...patch }));
  }

  function patchAgeGroup(index: number, patch: Partial<AgeBand>) {
    update({
      ageGroups: state.ageGroups.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    });
  }

  function patchAward(index: number, patch: Partial<AwardRule>) {
    update({
      awards: state.awards.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    });
  }

  const payload = serializeRaceScoring(state);
  const hasContent =
    initial.ageGroups.length > 0 || initial.awards.length > 0 || Boolean(initial.notes);

  return (
    <div className="sm:col-span-2">
      <input type="hidden" name="ageGroupRules" value={JSON.stringify(payload.ageGroups)} />
      <input type="hidden" name="awardRules" value={JSON.stringify(payload.awards)} />
      <input type="hidden" name="scoringNotes" value={payload.notes ?? ""} />

      <CollapsibleCard nested title="Awards and age groups" defaultOpen={hasContent}>
        <div className="space-y-5">
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-bold text-slate-950">Age groups</h4>
              <button
                type="button"
                onClick={() => update({ ageGroups: [...state.ageGroups, emptyAgeBand()] })}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
              >
                Add age group
              </button>
            </div>
            <div className="space-y-3">
              {state.ageGroups.map((band, index) => (
                <article
                  key={`age-${index}`}
                  className="space-y-2 rounded-xl border border-slate-200 bg-white p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium text-slate-800">
                      {formatAgeBand(band) || "New age group"}
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        update({
                          ageGroups: state.ageGroups.filter((_, item) => item !== index),
                        })
                      }
                      className="text-xs font-semibold text-red-700"
                    >
                      Remove
                    </button>
                  </div>
                  <GenderChips
                    value={band.genders}
                    onChange={(genders) => patchAgeGroup(index, { genders })}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <AgeInput
                      label="Min age"
                      value={band.minAge}
                      onChange={(minAge) => patchAgeGroup(index, { minAge })}
                    />
                    <AgeInput
                      label="Max age"
                      value={band.maxAge}
                      onChange={(maxAge) => patchAgeGroup(index, { maxAge })}
                    />
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="min-w-[7rem] flex-1">
                      <AgeInput
                        label="Awards depth"
                        min={1}
                        value={band.awardDepth}
                        onChange={(awardDepth) => patchAgeGroup(index, { awardDepth })}
                      />
                    </div>
                    {state.ageGroups.length > 1 ? (
                      <button
                        type="button"
                        onClick={() =>
                          update({
                            ageGroups: copyAwardDepthToOtherBands(state.ageGroups, index),
                          })
                        }
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                      >
                        Copy to other age groups
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
              {!state.ageGroups.length ? (
                <p className="text-sm text-slate-500">No age groups yet.</p>
              ) : null}
            </div>
            <details className="rounded-xl bg-slate-50 p-3">
              <summary className="cursor-pointer text-sm font-semibold text-slate-900">
                Bulk age group add
              </summary>
              <div className="mt-3 space-y-3">
                <GenderChips
                  value={series.genders}
                  onChange={(genders) => setSeries((current) => ({ ...current, genders }))}
                />
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="text-xs text-slate-600">
                    Start age
                    <input
                      type="number"
                      min={0}
                      value={series.start}
                      onChange={(event) =>
                        setSeries((current) => ({ ...current, start: event.target.value }))
                      }
                      className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
                    />
                  </label>
                  <label className="text-xs text-slate-600">
                    Span (years)
                    <input
                      type="number"
                      min={1}
                      value={series.span}
                      onChange={(event) =>
                        setSeries((current) => ({ ...current, span: event.target.value }))
                      }
                      className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
                    />
                  </label>
                  <label className="text-xs text-slate-600">
                    Last age
                    <input
                      type="number"
                      min={0}
                      value={series.lastHigh}
                      onChange={(event) =>
                        setSeries((current) => ({ ...current, lastHigh: event.target.value }))
                      }
                      className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
                    />
                  </label>
                </div>
                {seriesError ? (
                  <p className="text-sm text-red-700">{seriesError}</p>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    try {
                      const inheritedDepth =
                        state.ageGroups.find((band) => band.awardDepth != null)?.awardDepth ??
                        null;
                      const added = buildAgeBandSeries({
                        genders: series.genders,
                        start: Number(series.start),
                        span: Number(series.span),
                        lastHigh: Number(series.lastHigh),
                        awardDepth: inheritedDepth,
                      });
                      update({ ageGroups: [...state.ageGroups, ...added] });
                      setSeriesError(null);
                    } catch (error) {
                      setSeriesError(
                        error instanceof Error ? error.message : "Could not build that series.",
                      );
                    }
                  }}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white"
                >
                  Add age groups
                </button>
              </div>
            </details>
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-bold text-slate-950">Awards</h4>
              <button
                type="button"
                onClick={() => update({ awards: [...state.awards, emptyAward()] })}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
              >
                Add award
              </button>
            </div>
            <div className="space-y-3">
              {state.awards.map((award, index) => (
                <article
                  key={`award-${index}`}
                  className="space-y-2 rounded-xl border border-slate-200 bg-white p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium text-slate-800">
                      {formatAwardRule({ ...award, title: award.title || "New award" })}
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        update({
                          awards: state.awards.filter((_, item) => item !== index),
                        })
                      }
                      className="text-xs font-semibold text-red-700"
                    >
                      Remove
                    </button>
                  </div>
                  <label className="block text-xs text-slate-600">
                    Title
                    <input
                      value={award.title}
                      onChange={(event) => patchAward(index, { title: event.target.value })}
                      placeholder="Overall, Masters…"
                      className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
                    />
                  </label>
                  <GenderChips
                    value={award.genders}
                    onChange={(genders) => patchAward(index, { genders })}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <AgeInput
                      label="Min age"
                      value={award.minAge}
                      onChange={(minAge) => patchAward(index, { minAge })}
                    />
                    <AgeInput
                      label="Max age"
                      value={award.maxAge}
                      onChange={(maxAge) => patchAward(index, { maxAge })}
                    />
                  </div>
                </article>
              ))}
              {!state.awards.length ? (
                <p className="text-sm text-slate-500">
                  Overall, Masters, and similar awards that sit outside age groups.
                </p>
              ) : null}
            </div>
          </section>

          <label className="block text-sm">
            Notes
            <textarea
              value={state.notes ?? ""}
              onChange={(event) => update({ notes: event.target.value || null })}
              rows={3}
              placeholder="Oddball exceptions only. Left blank, this stays off the calendar invite."
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
        </div>
      </CollapsibleCard>
    </div>
  );
}
