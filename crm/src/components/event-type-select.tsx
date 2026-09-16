import {
  eventTypeLabel,
  parseTaskEventType,
  timelineEventTypes,
} from "@/lib/crm/domain";

export function EventTypeSelect({
  name = "eventType",
  defaultValue,
  required = true,
  className = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2",
}: {
  name?: string;
  defaultValue?: string;
  required?: boolean;
  className?: string;
}) {
  const selected = defaultValue ? parseTaskEventType(defaultValue) : undefined;
  return (
    <select
      name={name}
      required={required}
      defaultValue={selected}
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
