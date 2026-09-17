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
    <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
      <label className="block md:hidden">
        <span className="sr-only">{ariaLabel}</span>
        <select
          value={selected?.href ?? ""}
          aria-label={ariaLabel}
          onChange={(event) => {
            if (event.target.value) router.push(event.target.value);
          }}
          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm font-semibold text-slate-900 shadow-sm"
        >
          {options.map((option) => (
            <option key={option.value} value={option.href}>
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
