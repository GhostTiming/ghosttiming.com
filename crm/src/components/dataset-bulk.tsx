"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { BulkActionResult } from "@/app/bulk-actions";

export type BulkChoice = {
  value: string;
  label: string;
  destructive?: boolean;
  extra?: BulkField;
};

export type BulkField = {
  key: string;
  label: string;
  type: "select" | "text";
  options?: BulkChoice[];
  placeholder?: string;
};

export type BulkExtraAction = {
  key: string;
  label: string;
  confirm: string;
  pendingLabel?: string;
  action: (ids: string[]) => Promise<BulkActionResult>;
};

type BulkContextValue = {
  selected: Set<string>;
  toggle: (id: string) => void;
  setAll: (ids: string[], on: boolean) => void;
  clear: () => void;
};

const BulkContext = createContext<BulkContextValue | null>(null);

function useBulk() {
  const value = useContext(BulkContext);
  if (!value) throw new Error("Dataset bulk controls need DatasetBulkRoot.");
  return value;
}

export function DatasetBulkRoot({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const setAll = useCallback((ids: string[], on: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);
  const clear = useCallback(() => setSelected(new Set()), []);
  const value = useMemo(
    () => ({ selected, toggle, setAll, clear }),
    [selected, toggle, setAll, clear],
  );
  return <BulkContext.Provider value={value}>{children}</BulkContext.Provider>;
}

export function DatasetCheckbox({
  id,
  disabled,
}: {
  id: string;
  disabled?: boolean;
}) {
  const { selected, toggle } = useBulk();
  return (
    <input
      type="checkbox"
      checked={selected.has(id)}
      disabled={disabled}
      aria-label="Select row"
      className="relative z-10 size-5 rounded border-slate-300 md:size-4"
      onChange={() => toggle(id)}
      onClick={(event) => event.stopPropagation()}
    />
  );
}

export function DatasetHeaderCheckbox({ ids }: { ids: string[] }) {
  const { selected, setAll } = useBulk();
  const checked = ids.length > 0 && ids.every((id) => selected.has(id));
  const mixed = !checked && ids.some((id) => selected.has(id));
  return (
    <input
      type="checkbox"
      checked={checked}
      ref={(node) => {
        if (node) node.indeterminate = mixed;
      }}
      disabled={!ids.length}
      aria-label="Select all rows"
      className="relative z-10 size-5 rounded border-slate-300 md:size-4"
      onChange={(event) => setAll(ids, event.target.checked)}
      onClick={(event) => event.stopPropagation()}
    />
  );
}

function FieldControl({
  field,
  value,
  onChange,
}: {
  field: BulkField;
  value: Record<string, string>;
  onChange: (key: string, next: string, clearKeys?: string[]) => void;
}) {
  const current = value[field.key] ?? "";
  const choice = field.options?.find((option) => option.value === current);
  const nestedKeys = collectFieldKeys(choice?.extra);
  return (
    <>
      {field.type === "text" ? (
        <input
          value={current}
          placeholder={field.placeholder ?? field.label}
          onChange={(event) => onChange(field.key, event.target.value, nestedKeys)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      ) : (
        <select
          value={current}
          onChange={(event) => onChange(field.key, event.target.value, nestedKeys)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">
            {field.options?.some((option) => option.value === "")
              ? field.options.find((option) => option.value === "")?.label
              : `Select ${field.label.toLowerCase()}`}
          </option>
          {field.options
            ?.filter((option) => option.value !== "")
            .map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
      {choice?.extra ? (
        <FieldControl field={choice.extra} value={value} onChange={onChange} />
      ) : null}
    </>
  );
}

function collectFieldKeys(field?: BulkField): string[] {
  if (!field) return [];
  return [
    field.key,
    ...(field.options ?? []).flatMap((option) => collectFieldKeys(option.extra)),
  ];
}

function isDestructiveChoice(field: BulkField | undefined, value: Record<string, string>): boolean {
  if (!field) return false;
  const choice = field.options?.find((option) => option.value === value[field.key]);
  if (choice?.destructive) return true;
  return isDestructiveChoice(choice?.extra, value);
}

function extrasComplete(field: BulkField | undefined, value: Record<string, string>): boolean {
  if (!field) return false;
  const current = value[field.key] ?? "";
  if (field.type === "text") return Boolean(current.trim());
  const choice = field.options?.find((option) => option.value === current);
  if (!choice) return false;
  if (!choice.extra) return true;
  return extrasComplete(choice.extra, value);
}

function extraFromValue(field: BulkField | undefined, value: Record<string, string>) {
  const extra: Record<string, string> = {};
  let current = field;
  while (current) {
    const fieldKey = current.key;
    const choice = current.options?.find((option) => option.value === value[fieldKey]);
    current = choice?.extra;
    if (!current) break;
    const extraKey = current.key;
    if (value[extraKey]) extra[extraKey] = value[extraKey];
  }
  return extra;
}

export function DatasetBulkBar({
  fields,
  extraActions = [],
  updateAction,
  noun = "rows",
}: {
  fields: BulkField[];
  extraActions?: BulkExtraAction[];
  updateAction: (input: {
    ids: string[];
    field: string;
    value: string;
    extra?: Record<string, string | null | undefined>;
  }) => Promise<BulkActionResult>;
  noun?: string;
}) {
  const { selected, clear } = useBulk();
  const [fieldKey, setFieldKey] = useState(fields[0]?.key ?? "");
  const [values, setValues] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const ids = [...selected];
  const field = fields.find((item) => item.key === fieldKey);
  const value = field ? (values[field.key] ?? "") : "";
  const extra = extraFromValue(field, values);
  const destructive = isDestructiveChoice(field, values);
  const extraComplete = extrasComplete(field, values);
  const canApply = Boolean(field && extraComplete && !pending);

  function setValue(key: string, next: string, clearKeys: string[] = []) {
    setValues((current) => {
      const copy = { ...current, [key]: next };
      for (const clearKey of clearKeys) delete copy[clearKey];
      return copy;
    });
  }

  async function apply() {
    if (!field || !canApply) return;
    if (destructive && !window.confirm(`Apply this change to ${ids.length} ${noun}?`)) {
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const outcome = await updateAction({
        ids,
        field: field.key,
        value,
        extra: { ...extra, confirmed: destructive ? "1" : undefined },
      });
      setMessage(outcome.message);
      if (outcome.updated) clear();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Update failed.");
    } finally {
      setPending(false);
    }
  }

  async function runExtra(action: BulkExtraAction) {
    if (!ids.length) return;
    if (!window.confirm(action.confirm.replace("{n}", String(ids.length)))) return;
    setPending(true);
    setMessage(null);
    try {
      const outcome = await action.action(ids);
      setMessage(outcome.message);
      if (outcome.updated) clear();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Update failed.");
    } finally {
      setPending(false);
    }
  }

  if (!ids.length && !message) return null;

  return (
    <div className="sticky top-[6.75rem] z-20 flex flex-wrap items-center gap-2 rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm shadow-sm md:top-0">
      <p className="font-semibold text-cyan-950">
        {ids.length} {noun} selected
      </p>
      {fields.length ? (
        <>
          <select
            value={fieldKey}
            onChange={(event) => {
              setFieldKey(event.target.value);
              setValues({});
            }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2"
          >
            {fields.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
          {field ? (
            <FieldControl field={field} value={values} onChange={setValue} />
          ) : null}
          <button
            type="button"
            disabled={!canApply}
            onClick={() => void apply()}
            className="rounded-lg bg-slate-900 px-3 py-2 font-semibold text-white disabled:opacity-50"
          >
            {pending ? "Updating…" : "Update"}
          </button>
        </>
      ) : null}
      {extraActions.map((action) => (
        <button
          key={action.key}
          type="button"
          disabled={!ids.length || pending}
          onClick={() => void runExtra(action)}
          className="rounded-lg border border-cyan-700 px-3 py-2 font-semibold text-cyan-800 disabled:opacity-50"
        >
          {pending ? action.pendingLabel ?? "Working…" : action.label}
        </button>
      ))}
      {message ? <p className="w-full text-slate-700">{message}</p> : null}
    </div>
  );
}
