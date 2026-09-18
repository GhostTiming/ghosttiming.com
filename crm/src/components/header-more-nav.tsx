"use client";

import { Ban, Building2, CalendarDays, ChevronDown, Contact, Mail } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export function HeaderMoreNav({
  canAccessOperations,
  canAccessProspecting,
}: {
  canAccessOperations: boolean;
  canAccessProspecting: boolean;
}) {
  const pathname = usePathname();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const items = [
    canAccessOperations
      ? {
          href: "/organizations",
          label: "Organizations",
          icon: Building2,
        }
      : null,
    canAccessOperations || canAccessProspecting
      ? {
          href: "/contacts",
          label: "Contacts",
          icon: Contact,
        }
      : null,
    canAccessProspecting
      ? {
          href: "/prospecting/pending-emails",
          label: "Pending emails",
          icon: Mail,
        }
      : null,
    canAccessProspecting
      ? {
          href: "/prospecting/blacklist",
          label: "Email blacklist",
          icon: Ban,
        }
      : null,
    canAccessOperations
      ? {
          href: "/events",
          label: "Events",
          icon: CalendarDays,
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));
  const active = items.some((item) => pathname.startsWith(item.href));

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, []);

  if (!items.length) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((current) => !current)}
        className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-white/10 ${
          active ? "bg-white/10 text-white" : "text-slate-200"
        }`}
      >
        More
        <ChevronDown aria-hidden className="size-4" />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute left-0 z-50 mt-2 min-w-52 rounded-xl border border-slate-200 bg-white py-1 text-slate-950 shadow-xl"
        >
          {items.map((item) => {
            const Icon = item.icon;
            const isActive = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className={`flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 ${
                  isActive ? "font-semibold text-cyan-800" : "text-slate-800"
                }`}
              >
                <Icon aria-hidden className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
