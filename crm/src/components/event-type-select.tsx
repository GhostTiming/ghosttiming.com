import type { ChangeEvent } from "react";
import {
  eventTypeLabel,
  parseTaskEventType,
  timelineEventTypes,
} from "@/lib/crm/domain";

export function EventTypeSelect({
  name = "eventType",
  defaultValue,
  value,
  onChange,
  required = true,
  className = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2",
}: {
  name?: string;
  defaultValue?: string;
  value?: string;
  onChange?: (event: ChangeEvent<HTMLSelectElement>) => void;
  required?: boolean;
  className?: string;
}) {
  const selected = (value ?? defaultValue)
    ? parseTaskEventType(value || defaultValue || "")
    : "";
  return (
    <select
      name={name}
      required={required}
      value={value !== undefined ? selected : undefined}
      defaultValue={value === undefined ? selected || undefined : undefined}
      onChange={onChange}
      className={className}
    >
      {!selected ? <option value="">Select type</option> : null}
      {timelineEventTypes.map((type) => (
        <option key={type} value={type}>
          {eventTypeLabel(type)}
        </option>
      ))}
    </select>
  );
}
