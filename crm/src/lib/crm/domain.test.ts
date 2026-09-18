import { describe, expect, it } from "vitest";
import {
  activityEventType,
  activityTypeFromEventType,
  countTouches,
  formatCalendarDate,
  formatNextStep,
  formatTaskHeadline,
  eventHasAlreadyOccurred,
  isClosedProspectStage,
  isEmailTimelineActivity,
  bookingStageTone,
  latestNonStageActivity,
  prospectStageTone,
  parseEmailActivityBody,
  parseTaskEventType,
  prospectStageFromLegacyStatus,
  prospectListOutcomeStages,
  shouldCloseProspect,
  validateClosedLostDetails,
  validateDisqualifiedDetails,
  validateUnqualifiedDetails,
  shouldMarkDoNotContact,
  taskDescription,
  timelineLabel,
} from "./domain";

describe("prospecting business rules", () => {
  it("counts calls, emails, and meetings but not notes", () => {
    expect(
      countTouches(["phone_call", "note", "email", "stage_change", "meeting"]),
    ).toBe(3);
  });

  it.each(["Event Canceled", "Already Booked", "Not Interested", "Do Not Contact"])(
    "closes a prospect for terminal disposition %s",
    (disposition) => {
      expect(shouldCloseProspect(disposition)).toBe(true);
    },
  );

  it.each([
    "Bad Timing / Try Again",
    "Bad Contact Information",
    "Timing Company",
    "Other",
    "No Answer",
    "Left Voicemail",
  ])("keeps a prospect open for non-terminal disposition %s", (disposition) => {
    expect(shouldCloseProspect(disposition)).toBe(false);
  });

  it("marks DNC only for the explicit disposition", () => {
    expect(shouldMarkDoNotContact("Do Not Contact")).toBe(true);
    expect(shouldMarkDoNotContact("Not Interested")).toBe(false);
  });

  it("maps legacy lead-note statuses onto closed pipeline stages", () => {
    expect(prospectStageFromLegacyStatus("disqualified_turned_us_down")).toBe(
      "disqualified",
    );
    expect(prospectStageFromLegacyStatus("unqualified_already_has_timer")).toBe(
      "unqualified",
    );
    expect(prospectStageFromLegacyStatus("qualified_contacting")).toBeNull();
    expect(isClosedProspectStage("closed_lost")).toBe(true);
    expect(isClosedProspectStage("disqualified")).toBe(true);
    expect(isClosedProspectStage("unqualified")).toBe(true);
    expect(isClosedProspectStage("past_event")).toBe(true);
    expect(isClosedProspectStage("cold")).toBe(false);
    expect(prospectStageTone("unqualified")).toBe("lost");
    expect(prospectStageTone("past_event")).toBe("lost");
    expect(prospectStageTone("cold")).toBe("live");
    expect(bookingStageTone("paid")).toBe("won");
    expect(bookingStageTone("closed_lost")).toBe("lost");
    expect(bookingStageTone("pre_event_prep")).toBe("live");
  });

  it("maps list outcome bubbles onto existing closed pipeline stages", () => {
    expect(prospectListOutcomeStages.map((stage) => stage.key)).toEqual([
      "closed_lost",
      "disqualified",
      "unqualified",
      "past_event",
    ]);
    for (const stage of prospectListOutcomeStages) {
      expect(isClosedProspectStage(stage.key)).toBe(true);
    }
  });

  it("requires a close-lost reason and a note only for Other", () => {
    expect(validateClosedLostDetails({ reason: "" }).success).toBe(false);
    expect(
      validateClosedLostDetails({ reason: "went_with_another_timer" }),
    ).toEqual({
      success: true,
      data: {
        reason: "went_with_another_timer",
        note: null,
        circleBackOn: null,
      },
    });
    expect(
      validateClosedLostDetails({
        reason: "other",
        note: "   ",
      }).success,
    ).toBe(false);
    expect(
      validateClosedLostDetails({
        reason: "event_cancelled",
        note: "Weather",
        circleBackOn: "2026-11-01",
      }),
    ).toEqual({
      success: true,
      data: {
        reason: "event_cancelled",
        note: "Weather",
        circleBackOn: "2026-11-01",
      },
    });
    expect(
      validateClosedLostDetails({
        reason: "no_decision",
        circleBackOn: "11/01/2026",
      }).success,
    ).toBe(false);
  });

  it("accepts the full unqualified reason list", () => {
    expect(validateUnqualifiedDetails({ reason: "" }).success).toBe(false);
    expect(
      validateUnqualifiedDetails({ reason: "event_too_soon" }),
    ).toEqual({
      success: true,
      data: { reason: "event_too_soon", note: null },
    });
    expect(
      validateUnqualifiedDetails({ reason: "already_has_timer" }),
    ).toEqual({
      success: true,
      data: { reason: "already_has_timer", note: null },
    });
    expect(
      validateUnqualifiedDetails({ reason: "untimed_event" }),
    ).toEqual({
      success: true,
      data: { reason: "untimed_event", note: null },
    });
    expect(validateUnqualifiedDetails({ reason: "no_need" })).toEqual({
      success: true,
      data: { reason: "no_need", note: null },
    });
    expect(
      validateUnqualifiedDetails({ reason: "other", note: "   " }).success,
    ).toBe(false);
  });

  it("accepts the full disqualified reason list", () => {
    expect(
      validateDisqualifiedDetails({ reason: "is_a_timing_company" }),
    ).toEqual({
      success: true,
      data: { reason: "is_a_timing_company", note: null },
    });
    expect(
      validateDisqualifiedDetails({ reason: "blacklisted_email" }),
    ).toEqual({
      success: true,
      data: { reason: "blacklisted_email", note: null },
    });
    expect(
      validateDisqualifiedDetails({ reason: "do_not_contact" }),
    ).toEqual({
      success: true,
      data: { reason: "do_not_contact", note: null },
    });
    expect(
      validateDisqualifiedDetails({ reason: "race_canceled" }),
    ).toEqual({
      success: true,
      data: { reason: "race_canceled", note: null },
    });
    expect(
      validateDisqualifiedDetails({ reason: "went_with_another_timer" }).success,
    ).toBe(false);
  });

  it("treats a race as past after its local calendar date", () => {
    expect(eventHasAlreadyOccurred("2026-08-12T12:00:00.000Z", new Date("2026-09-16T15:00:00.000Z"))).toBe(true);
    expect(eventHasAlreadyOccurred("2026-09-16T12:00:00.000Z", new Date("2026-09-16T15:00:00.000Z"))).toBe(false);
    expect(eventHasAlreadyOccurred("2026-09-17T12:00:00.000Z", new Date("2026-09-16T15:00:00.000Z"))).toBe(false);
    expect(eventHasAlreadyOccurred(null)).toBe(false);
  });
});

describe("timeline event types", () => {
  it("maps event types onto the existing activity enum", () => {
    expect(activityTypeFromEventType("email_out")).toBe("email");
    expect(activityTypeFromEventType("email_in")).toBe("email");
    expect(activityTypeFromEventType("call_out")).toBe("phone_call");
    expect(activityTypeFromEventType("call_in")).toBe("phone_call");
    expect(activityTypeFromEventType("meeting")).toBe("meeting");
    expect(activityTypeFromEventType("other")).toBe("note");
  });

  it("treats stored keys and legacy titles as event types", () => {
    expect(parseTaskEventType("email_in")).toBe("email_in");
    expect(parseTaskEventType("Call")).toBe("call_out");
    expect(parseTaskEventType("Follow up with Teresa")).toBe("other");
  });

  it("keeps a legacy title as the description until notes exist", () => {
    expect(taskDescription("Call", null)).toBe("Call");
    expect(taskDescription("call_out", null)).toBe("");
    expect(taskDescription("call_out", "Left a voicemail")).toBe("Left a voicemail");
  });

  it("formats task headlines and next-step labels", () => {
    expect(formatTaskHeadline("call_out", "Left a voicemail")).toBe(
      "Call Out: Left a voicemail",
    );
    expect(formatTaskHeadline("Call", null)).toBe("Call Out: Call");
    expect(formatTaskHeadline("Send timing proposal")).toBe("Send timing proposal");
    expect(formatNextStep("email_out")).toBe("Email Out");
    expect(formatNextStep("Send timing proposal")).toBe("Send timing proposal");
  });

  it("prefers metadata event type on the timeline", () => {
    expect(
      timelineLabel({ type: "email", metadata: { eventType: "email_in" } }),
    ).toBe("Email In");
    expect(timelineLabel({ type: "phone_call", metadata: {} })).toBe("Call Out");
    expect(timelineLabel({ type: "stage_change", metadata: {} })).toBe("Stage Change");
    expect(activityEventType({ type: "note", metadata: {} })).toBe("other");
  });

  it("treats Gmail and email event types as collapsible emails", () => {
    expect(isEmailTimelineActivity({ type: "email", metadata: {} })).toBe(true);
    expect(
      isEmailTimelineActivity({ type: "note", metadata: { source: "gmail" } }),
    ).toBe(true);
    expect(
      isEmailTimelineActivity({
        type: "note",
        metadata: { eventType: "email_in" },
      }),
    ).toBe(true);
    expect(isEmailTimelineActivity({ type: "phone_call", metadata: {} })).toBe(false);
  });

  it("parses Gmail activity bodies into subject, recipients, and body", () => {
    expect(
      parseEmailActivityBody(
        [
          "Subject: Timing quote",
          "From: Sarah <sarah@example.com>",
          "To: timing@ghosttiming.com",
          "",
          "Can you time our 5K?",
        ].join("\n"),
      ),
    ).toEqual({
      subject: "Timing quote",
      from: "Sarah <sarah@example.com>",
      to: "timing@ghosttiming.com",
      cc: null,
      body: "Can you time our 5K?",
    });
    expect(parseEmailActivityBody("Left a voicemail")).toEqual({
      subject: null,
      from: null,
      to: null,
      cc: null,
      body: "Left a voicemail",
    });
  });

  it("uses the latest non-stage activity as last step", () => {
    expect(
      latestNonStageActivity([
        { type: "stage_change" },
        { type: "email" },
      ])?.type,
    ).toBe("email");
    expect(latestNonStageActivity([{ type: "stage_change" }])).toBeNull();
  });

  it("formats calendar dates without UTC day-shift", () => {
    expect(formatCalendarDate("2026-09-16")).toBe("Sep 16, 2026");
    expect(formatCalendarDate(null)).toBeNull();
  });
});
