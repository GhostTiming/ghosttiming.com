export type TableFilterField =
  | {
      type: "text";
      name: string;
      label?: string;
      placeholder?: string;
    }
  | {
      type: "number";
      name: string;
      label?: string;
      placeholder?: string;
      min?: number;
    }
  | {
      type: "select";
      name: string;
      label?: string;
      options: { value: string; label: string }[];
    }
  | {
      type: "date";
      name: string;
      label?: string;
    }
  | {
      type: "date-range";
      fromName: string;
      toName: string;
      fromLabel?: string;
      toLabel?: string;
    };

export type TableQueryParams = Record<string, string | undefined>;

export function fieldNames(fields: TableFilterField[]) {
  return fields.flatMap((field) =>
    field.type === "date-range" ? [field.fromName, field.toName] : [field.name],
  );
}

function isMeaningful(value: string | undefined) {
  return Boolean(value) && value !== "all";
}

export function isFilterActive(
  params: TableQueryParams,
  fields: TableFilterField[],
) {
  return fieldNames(fields).some((name) => isMeaningful(params[name]));
}

export function applyColumnFilters(input: {
  pathname: string;
  params: TableQueryParams;
  fields: TableFilterField[];
  formValues: Record<string, string>;
}) {
  const names = fieldNames(input.fields);
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(input.params)) {
    if (!value || names.includes(key) || key === "page") continue;
    if (value === "all") continue;
    if (key === "direction" && value === "asc") continue;
    next.set(key, value);
  }
  for (const [name, raw] of Object.entries(input.formValues)) {
    const value = raw.trim();
    if (!value || value === "all") next.delete(name);
    else next.set(name, value);
  }
  const qs = next.toString();
  return qs ? `${input.pathname}?${qs}` : input.pathname;
}
