"use client";

import Link from "next/link";
import type { ReactNode } from "react";

export function ListRowLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`before:absolute before:inset-0 before:z-0 ${className ?? ""}`}
    >
      <span className="relative z-[1] inline-flex min-w-0 items-start gap-2.5">
        {children}
      </span>
    </Link>
  );
}

export function ListRowActions({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`relative z-10 ${className ?? ""}`.trim()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
}

