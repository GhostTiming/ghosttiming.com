"use client";

import { ChevronDown } from "lucide-react";
import { useLayoutEffect, useRef, type ReactNode } from "react";

export function CollapsibleCard({
  title,
  icon,
  children,
  defaultOpen = true,
  nested = false,
  meta,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  nested?: boolean;
  meta?: ReactNode;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useLayoutEffect(() => {
    if (defaultOpen && detailsRef.current) detailsRef.current.open = true;
  }, [defaultOpen]);

  const heading = (
    <>
      {icon}
      {title}
      {meta ? (
        <span className="ml-1 font-medium text-slate-500">{meta}</span>
      ) : null}
    </>
  );

  return (
    <section
      className={
        nested
          ? "rounded-xl border border-slate-200 bg-white"
          : "rounded-xl border border-slate-200 bg-white shadow-sm"
      }
    >
      <details
        ref={detailsRef}
        className={nested ? "group/nested" : "group/card"}
      >
        <summary
          className={`flex cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden ${
            nested ? "px-4 py-3" : "px-5 py-4"
          }`}
        >
          {nested ? (
            <h3 className="flex min-w-0 flex-1 items-center gap-2 text-sm font-bold text-slate-950">
              {heading}
            </h3>
          ) : (
            <h2 className="flex min-w-0 flex-1 items-center gap-2 text-lg font-bold text-slate-950">
              {heading}
            </h2>
          )}
          <ChevronDown
            aria-hidden
            className={`size-5 shrink-0 text-slate-400 transition ${
              nested ? "group-open/nested:rotate-180" : "group-open/card:rotate-180"
            }`}
          />
        </summary>
        <div
          className={`border-t border-slate-100 ${nested ? "px-4 py-4" : "px-5 py-4"}`}
        >
          {children}
        </div>
      </details>
    </section>
  );
}
