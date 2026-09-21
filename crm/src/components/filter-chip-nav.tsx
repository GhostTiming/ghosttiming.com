"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { chipClass } from "@/lib/crm/layout";

export type FilterChipOption = {
  value: string;
  label: string;
  href: string;
};

export function FilterChipNav({
  options,
  value,
  ariaLabel,
  children,
}: {
  options: FilterChipOption[];
  value: string;
  ariaLabel: string;
  children?: ReactNode;
}) {
  const router = useRouter();
  const selected = options.find((option) => option.value === value) ?? options[0];

  if (!options.length) return null;

  return (
    <div className="flex min-w-0 max-w-full flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
      <label className="block min-w-0 md:hidden">
        <span className="sr-only">{ariaLabel}</span>
        <select
          value={selected?.value ?? ""}
          aria-label={ariaLabel}
          onChange={(event) => {
            const next = options.find((option) => option.value === event.target.value);
            if (next) router.push(next.href);
          }}
          className="w-full max-w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm font-semibold text-slate-900 shadow-sm"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <nav className="hidden flex-wrap gap-2 md:flex" aria-label={ariaLabel}>
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
      {children ? <div className="w-full md:w-auto">{children}</div> : null}
    </div>
  );
}
