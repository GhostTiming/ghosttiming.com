import { describe, expect, it } from "vitest";
import { nextStepTaskPlan } from "./next-step-task";

describe("nextStepTaskPlan", () => {
  it("upserts when a date and task text are both present", () => {
    expect(
      nextStepTaskPlan({
        nextStepOn: "2026-10-02",
        nextStepNote: "  Call the RD  ",
      }),
    ).toEqual({
      action: "upsert",
      dueOn: "2026-10-02",
      title: "Call the RD",
    });
  });

  it("clears when the date or task text is missing", () => {
    expect(
      nextStepTaskPlan({ nextStepOn: "2026-10-02", nextStepNote: "   " }),
    ).toEqual({ action: "clear" });
    expect(
      nextStepTaskPlan({ nextStepOn: "", nextStepNote: "Follow up" }),
    ).toEqual({ action: "clear" });
    expect(nextStepTaskPlan({})).toEqual({ action: "clear" });
  });
});
