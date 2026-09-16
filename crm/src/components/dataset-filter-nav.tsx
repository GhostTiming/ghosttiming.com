"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

export type DatasetFilterOption = {
  value: string;
  label: string;
  href: string;
};

const chipClass = (active: boolean) =>
  `rounded-md px-3 py-1.5 text-sm font-medium ring-1 transition-colors ${
    active
      ? "bg-slate-900 text-white ring-slate-900"
      : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"
  }`;

/**
 * Dataset view/stage filters: full-width native select on phone,
 * compact chip row on md+. Avoids the sideways “bubble” strip on mobile.
 */
export function DatasetFilterNav({
  ariaLabel,
  options,
  value,
  trailing,
}: {
  ariaLabel: string;
  options: DatasetFilterOption[];
  value: string;
  /** Optional control shown beside chips (desktop) / under select (mobile). */
  trailing?: ReactNode;
}) {
  const router = useRouter();
  const current =
    options.find((option) => option.value === value) ?? options[0];

  return (
    <div className="min-w-0 space-y-2">
      <label className="block md:hidden">
        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">
          {ariaLabel}
        </span>
        <select
          className="w-full max-w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 shadow-sm"
          aria-label={ariaLabel}
          value={current?.value ?? ""}
          onChange={(event) => {
            const next = options.find(
              (option) => option.value === event.target.value,
            );
            if (next) router.push(next.href);
          }}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {trailing ? <div className="md:hidden">{trailing}</div> : null}

      <div className="hidden min-w-0 items-center gap-2 md:flex md:flex-wrap">
        <nav className="flex min-w-0 flex-wrap gap-2" aria-label={ariaLabel}>
          {options.map((option) => (
            <Link
              key={option.value}
              href={option.href}
              className={chipClass(option.value === value)}
            >
              {option.label}
            </Link>
          ))}
        </nav>
        {trailing}
      </div>
    </div>
  );
}
