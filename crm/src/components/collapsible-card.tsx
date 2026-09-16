"use client";

import { ChevronDown } from "lucide-react";
import { useLayoutEffect, useRef, type ReactNode } from "react";

export function CollapsibleCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useLayoutEffect(() => {
    const node = detailsRef.current;
    if (node) node.open = true;
  }, []);

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <details ref={detailsRef} className="group">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 [&::-webkit-details-marker]:hidden">
          <h2 className="flex min-w-0 flex-1 items-center gap-2 text-lg font-bold text-slate-950">
            {icon}
            {title}
          </h2>
          <ChevronDown
            aria-hidden
            className="size-5 shrink-0 text-slate-400 transition group-open:rotate-180"
          />
        </summary>
        <div className="border-t border-slate-100 px-5 py-4">{children}</div>
      </details>
    </section>
  );
}
