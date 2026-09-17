import { describe, expect, it } from "vitest";
import {
  isDestructiveBulkUpdate,
  parseBulkIds,
  parseBulkListingIds,
  validateBulkUpdate,
} from "./bulk-update";

describe("bulk update validation", () => {
  it("requires a bounded list of uuids", () => {
    expect(parseBulkIds([]).success).toBe(false);
    expect(parseBulkIds(["not-a-uuid"]).success).toBe(false);
    const ids = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ];
    expect(parseBulkIds(ids)).toEqual({ success: true, ids });
  });

  it("accepts catalog listing ids for candidate bulk updates", () => {
    expect(parseBulkListingIds(["listing-mount-dora", "abc"]).success).toBe(true);
    expect(
      validateBulkUpdate("candidates", {
        field: "stage",
        value: "disqualified",
        extra: { reason: "is_a_timing_company" },
      }),
    ).toEqual({ success: true });
    expect(
      validateBulkUpdate("candidates", { field: "assignee", value: "x" }).success,
    ).toBe(false);
  });

  it("requires an unqualified reason including Event too soon", () => {
    expect(
      validateBulkUpdate("prospects", { field: "stage", value: "unqualified" })
        .success,
    ).toBe(false);
    expect(
      validateBulkUpdate("prospects", {
        field: "stage",
        value: "unqualified",
        extra: { reason: "event_too_soon" },
      }),
    ).toEqual({ success: true });
  });

  it("requires a disqualified reason including Is a timing company", () => {
    expect(
      validateBulkUpdate("prospects", {
        field: "stage",
        value: "disqualified",
        extra: { reason: "is_a_timing_company" },
      }),
    ).toEqual({ success: true });
    expect(
      validateBulkUpdate("prospects", {
        field: "stage",
        value: "disqualified",
        extra: { reason: "not_a_reason" },
      }).success,
    ).toBe(false);
  });

  it("rejects fields that are not mass-editable", () => {
    expect(
      validateBulkUpdate("prospects", { field: "expected_revenue", value: "1" })
        .success,
    ).toBe(false);
    expect(
      validateBulkUpdate("bookings", { field: "actual_revenue", value: "1" })
        .success,
    ).toBe(false);
    expect(
      validateBulkUpdate("bookings", { field: "stage", value: "confirmed" }),
    ).toEqual({ success: true });
    expect(
      validateBulkUpdate("bookings", {
        field: "timer_location",
        value: "remote",
      }),
    ).toEqual({ success: true });
    expect(
      validateBulkUpdate("contacts", { field: "status", value: "inactive" }),
    ).toEqual({ success: true });
    expect(
      validateBulkUpdate("tasks", { field: "status", value: "complete" }),
    ).toEqual({ success: true });
  });

  it("flags destructive outcome changes", () => {
    expect(isDestructiveBulkUpdate("prospects", "stage", "unqualified")).toBe(
      true,
    );
    expect(isDestructiveBulkUpdate("prospects", "stage", "cold")).toBe(false);
    expect(isDestructiveBulkUpdate("bookings", "stage", "closed_lost")).toBe(
      true,
    );
    expect(isDestructiveBulkUpdate("organizations", "status", "archived")).toBe(
      true,
    );
  });
});
