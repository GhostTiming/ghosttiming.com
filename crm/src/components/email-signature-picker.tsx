"use client";

import Link from "next/link";
import type { EmailSignatureSummary } from "@/lib/crm/email-signatures";

const field = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";

export function EmailSignaturePicker({
  signatures,
  value,
  onChange,
  preview = true,
}: {
  signatures: EmailSignatureSummary[];
  value: string;
  onChange: (id: string) => void;
  preview?: boolean;
}) {
  if (!signatures.length) {
    return (
      <p className="text-sm text-slate-500">
        No signatures yet.{" "}
        <Link href="/settings#email-signatures" className="font-semibold text-cyan-800 underline">
          Add one in Settings
        </Link>
        .
      </p>
    );
  }

  const selected = signatures.find((item) => item.id === value) ?? null;

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium">
        Signature
        <select
          className={field}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">None</option>
          {signatures.map((signature) => (
            <option key={signature.id} value={signature.id}>
              {signature.name}
              {signature.is_default ? " (default)" : ""}
            </option>
          ))}
        </select>
      </label>
      {preview && selected ? (
        <iframe
          title={`${selected.name} signature preview`}
          sandbox=""
          srcDoc={selected.body_html}
          className="h-36 w-full rounded-lg border border-slate-200 bg-white"
        />
      ) : null}
    </div>
  );
}
