import type { BulkField } from "@/components/dataset-bulk";
import {
  closedLostReasonLabels,
  closedLostReasons,
  disqualifiedReasonLabels,
  disqualifiedReasons,
  prospectPipelineStageKeys,
  prospectPipelineStageLabels,
  unqualifiedReasonLabels,
  unqualifiedReasons,
} from "./domain";

function reasonField(
  reasons: ReadonlyArray<string>,
  labels: Record<string, string>,
): BulkField {
  return {
    key: "reason",
    label: "Reason",
    type: "select",
    options: reasons.map((key) => ({
      value: key,
      label: labels[key] ?? key,
      extra:
        key === "other"
          ? { key: "note", label: "Note", type: "text", placeholder: "Add a note" }
          : undefined,
    })),
  };
}

export function prospectBulkFields(
  users: Array<{ id: string; name: string }>,
): BulkField[] {
  return [
    {
      key: "stage",
      label: "Stage",
      type: "select",
      options: prospectPipelineStageKeys.map((key) => ({
        value: key,
        label: prospectPipelineStageLabels[key],
        destructive: key === "closed_lost" || key === "disqualified" || key === "unqualified" || key === "past_event",
        extra:
          key === "closed_lost"
            ? reasonField(closedLostReasons, closedLostReasonLabels)
            : key === "unqualified"
              ? reasonField(unqualifiedReasons, unqualifiedReasonLabels)
              : key === "disqualified"
                ? reasonField(disqualifiedReasons, disqualifiedReasonLabels)
                : undefined,
      })),
    },
    {
      key: "assignee",
      label: "Assignee",
      type: "select",
      options: [
        { value: "__unassigned__", label: "Unassigned" },
        ...users.map((user) => ({ value: user.id, label: user.name })),
      ],
    },
  ];
}

export function bookingBulkFields(
  stages: Array<{ key: string; name: string }>,
  users: Array<{ id: string; name: string }>,
): BulkField[] {
  return [
    {
      key: "stage",
      label: "Stage",
      type: "select",
      options: stages.map((stage) => ({
        value: stage.key,
        label: stage.name,
        destructive: stage.key === "closed_lost",
      })),
    },
    {
      key: "assignee",
      label: "Assignee",
      type: "select",
      options: [
        { value: "__unassigned__", label: "Unassigned" },
        ...users.map((user) => ({ value: user.id, label: user.name })),
      ],
    },
    {
      key: "timer_location",
      label: "Timer location",
      type: "select",
      options: [
        { value: "on_site", label: "On site" },
        { value: "remote", label: "Remote" },
      ],
    },
  ];
}

export const contactBulkFields: BulkField[] = [
  {
    key: "status",
    label: "Status",
    type: "select",
    options: [
      { value: "active", label: "Active" },
      { value: "inactive", label: "Inactive", destructive: true },
    ],
  },
];

export const organizationBulkFields: BulkField[] = [
  {
    key: "status",
    label: "Status",
    type: "select",
    options: [
      { value: "active", label: "Active" },
      { value: "archived", label: "Archived", destructive: true },
    ],
  },
];

export function eventBulkFields(
  organizations: Array<{ id: string; name: string }>,
): BulkField[] {
  return [
    {
      key: "owner",
      label: "Owner",
      type: "select",
      options: [
        { value: "__unassigned__", label: "Unassigned" },
        ...organizations.map((org) => ({ value: org.id, label: org.name })),
      ],
    },
  ];
}

export const taskBulkFields: BulkField[] = [
  {
    key: "status",
    label: "Status",
    type: "select",
    options: [
      { value: "open", label: "Open" },
      { value: "complete", label: "Complete" },
      { value: "canceled", label: "Canceled", destructive: true },
    ],
  },
];
