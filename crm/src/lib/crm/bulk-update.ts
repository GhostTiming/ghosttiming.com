import { z } from "zod";
import {
  bookingPipelineStageKeys,
  closedLostReasons,
  destructiveProspectStageKeys,
  disqualifiedReasons,
  prospectPipelineStageKeys,
  unqualifiedReasons,
  validateClosedLostDetails,
  validateDisqualifiedDetails,
  validateUnqualifiedDetails,
} from "./domain";

export const MAX_BULK_IDS = 500;

export const bulkDatasets = [
  "prospects",
  "bookings",
  "contacts",
  "organizations",
  "events",
  "tasks",
] as const;
export type BulkDataset = (typeof bulkDatasets)[number];

const uuid = z.string().uuid();

export function parseBulkIds(raw: unknown) {
  const values = Array.isArray(raw)
    ? raw.map((value) => String(value))
    : typeof raw === "string"
      ? raw.split(",").map((value) => value.trim()).filter(Boolean)
      : [];
  if (!values.length) {
    return { success: false as const, error: "Select at least one row." };
  }
  if (values.length > MAX_BULK_IDS) {
    return {
      success: false as const,
      error: `Select at most ${MAX_BULK_IDS} rows at a time.`,
    };
  }
  const parsed: string[] = [];
  for (const value of values) {
    const id = uuid.safeParse(value);
    if (!id.success) {
      return { success: false as const, error: "One or more selected ids are invalid." };
    }
    parsed.push(id.data);
  }
  return { success: true as const, ids: [...new Set(parsed)] };
}

export type BulkUpdateInput = {
  ids: string[];
  field: string;
  value: string;
  extra?: Record<string, string | null | undefined>;
};

export type ParsedBulkUpdate =
  | { success: true; data: BulkUpdateInput }
  | { success: false; error: string };

function extraValue(
  extra: BulkUpdateInput["extra"],
  key: string,
) {
  return extra?.[key]?.trim() || null;
}

export function isDestructiveBulkUpdate(
  dataset: BulkDataset,
  field: string,
  value: string,
) {
  if (dataset === "prospects" && field === "stage") {
    return (destructiveProspectStageKeys as readonly string[]).includes(value);
  }
  if (dataset === "bookings" && field === "stage") {
    return value === "closed_lost";
  }
  if (dataset === "contacts" && field === "status") {
    return value === "inactive";
  }
  if (dataset === "organizations" && field === "status") {
    return value === "archived";
  }
  if (dataset === "tasks" && field === "status") {
    return value === "canceled";
  }
  return false;
}

export function validateProspectBulkUpdate(input: {
  field: string;
  value: string;
  extra?: BulkUpdateInput["extra"];
}): ParsedBulkUpdate["success"] extends never ? never : { success: true } | { success: false; error: string } {
  if (input.field === "stage") {
    if (!(prospectPipelineStageKeys as readonly string[]).includes(input.value)) {
      return { success: false, error: "Choose a valid prospect stage." };
    }
    if (input.value === "closed_lost") {
      const result = validateClosedLostDetails({
        reason: extraValue(input.extra, "reason"),
        note: extraValue(input.extra, "note"),
        circleBackOn: extraValue(input.extra, "circleBackOn"),
      });
      return result.success ? { success: true } : result;
    }
    if (input.value === "unqualified") {
      const result = validateUnqualifiedDetails({
        reason: extraValue(input.extra, "reason"),
        note: extraValue(input.extra, "note"),
      });
      return result.success ? { success: true } : result;
    }
    if (input.value === "disqualified") {
      const result = validateDisqualifiedDetails({
        reason: extraValue(input.extra, "reason"),
        note: extraValue(input.extra, "note"),
      });
      return result.success ? { success: true } : result;
    }
    return { success: true };
  }
  if (input.field === "assignee") {
    if (!input.value || input.value === "__unassigned__") return { success: true };
    if (!uuid.safeParse(input.value).success) {
      return { success: false, error: "Choose a valid assignee." };
    }
    return { success: true };
  }
  return { success: false, error: "That prospect field cannot be mass-updated." };
}

export function validateBookingBulkUpdate(input: {
  field: string;
  value: string;
}): { success: true } | { success: false; error: string } {
  if (input.field === "stage") {
    if (!(bookingPipelineStageKeys as readonly string[]).includes(input.value)) {
      return { success: false, error: "Choose a valid booking stage." };
    }
    return { success: true };
  }
  if (input.field === "assignee") {
    if (!input.value || input.value === "__unassigned__") return { success: true };
    if (!uuid.safeParse(input.value).success) {
      return { success: false, error: "Choose a valid assignee." };
    }
    return { success: true };
  }
  if (input.field === "timer_location") {
    if (input.value !== "on_site" && input.value !== "remote") {
      return { success: false, error: "Choose on site or remote." };
    }
    return { success: true };
  }
  return { success: false, error: "That booking field cannot be mass-updated." };
}

export function validateContactBulkUpdate(input: {
  field: string;
  value: string;
}): { success: true } | { success: false; error: string } {
  if (input.field !== "status") {
    return { success: false, error: "That contact field cannot be mass-updated." };
  }
  if (input.value !== "active" && input.value !== "inactive") {
    return { success: false, error: "Choose active or inactive." };
  }
  return { success: true };
}

export function validateOrganizationBulkUpdate(input: {
  field: string;
  value: string;
}): { success: true } | { success: false; error: string } {
  if (input.field !== "status") {
    return { success: false, error: "That organization field cannot be mass-updated." };
  }
  if (input.value !== "active" && input.value !== "archived") {
    return { success: false, error: "Choose active or archived." };
  }
  return { success: true };
}

export function validateEventBulkUpdate(input: {
  field: string;
  value: string;
}): { success: true } | { success: false; error: string } {
  if (input.field !== "owner") {
    return { success: false, error: "That event field cannot be mass-updated." };
  }
  if (!input.value || input.value === "__unassigned__") return { success: true };
  if (!uuid.safeParse(input.value).success) {
    return { success: false, error: "Choose a valid owner organization." };
  }
  return { success: true };
}

export function validateTaskBulkUpdate(input: {
  field: string;
  value: string;
}): { success: true } | { success: false; error: string } {
  if (input.field !== "status") {
    return { success: false, error: "That task field cannot be mass-updated." };
  }
  if (!["open", "complete", "canceled"].includes(input.value)) {
    return { success: false, error: "Choose a valid task status." };
  }
  return { success: true };
}

export function validateBulkUpdate(
  dataset: BulkDataset,
  input: { field: string; value: string; extra?: BulkUpdateInput["extra"] },
) {
  switch (dataset) {
    case "prospects":
      return validateProspectBulkUpdate(input);
    case "bookings":
      return validateBookingBulkUpdate(input);
    case "contacts":
      return validateContactBulkUpdate(input);
    case "organizations":
      return validateOrganizationBulkUpdate(input);
    case "events":
      return validateEventBulkUpdate(input);
    case "tasks":
      return validateTaskBulkUpdate(input);
  }
}

export const bulkReasonKeys = {
  closedLost: closedLostReasons,
  unqualified: unqualifiedReasons,
  disqualified: disqualifiedReasons,
} as const;
