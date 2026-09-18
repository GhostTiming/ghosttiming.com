"use client";

import {
  Ban,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  ClipboardList,
  Contact,
  LayoutDashboard,
  Mail,
  Menu,
  Search,
  Settings,
  Shield,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState, type ReactNode } from "react";
import { GoogleConnectionControl } from "@/components/google/google-connection-control";
import { SignOutForm } from "@/components/sign-out-form";
import { GHOST_TIMING_LOGO_WHITE } from "@/lib/branding";

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  match?: (pathname: string) => boolean;
};

function isActive(pathname: string, item: NavItem) {
  if (item.match) return item.match(pathname);
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function MobileShell({
  userName,
  displayRole,
  canAccessOperations,
  canAccessProspecting,
  canAccessTasks,
  canAccessGoogle,
  canAccessAdminConsole,
  search,
}: {
  userName: string;
  displayRole: string;
  canAccessOperations: boolean;
  canAccessProspecting: boolean;
  canAccessTasks: boolean;
  canAccessGoogle: boolean;
  canAccessAdminConsole: boolean;
  search: ReactNode;
}) {
  const pathname = usePathname();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [menuPath, setMenuPath] = useState(pathname);
  if (menuPath !== pathname) {
    setMenuPath(pathname);
    setOpen(false);
  }
  const primary: NavItem[] = [
    {
      href: "/dashboard",
      label: "Dashboard",
      icon: LayoutDashboard,
      match: (path) => path === "/dashboard" || path === "/",
    },
    ...(canAccessOperations
      ? [{ href: "/bookings", label: "Bookings", icon: BriefcaseBusiness }]
      : []),
    ...(canAccessProspecting
      ? [{ href: "/prospecting", label: "Prospecting", icon: Search }]
      : []),
    ...(canAccessTasks
      ? [{ href: "/tasks", label: "Tasks", icon: ClipboardList }]
      : []),
  ];
  const more: NavItem[] = [
    ...(canAccessOperations
      ? [
          { href: "/organizations", label: "Organizations", icon: Building2 },
          { href: "/events", label: "Events", icon: CalendarDays },
        ]
      : []),
    ...(canAccessOperations || canAccessProspecting
      ? [{ href: "/contacts", label: "Contacts", icon: Contact }]
      : []),
    ...(canAccessProspecting
      ? [
          { href: "/prospecting/pending-emails", label: "Pending emails", icon: Mail },
          { href: "/prospecting/blacklist", label: "Email blacklist", icon: Ban },
        ]
      : []),
    ...(canAccessAdminConsole
      ? [{ href: "/admin", label: "Admin", icon: Shield }]
      : []),
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <>
      <div className="md:hidden">
        <div className="flex items-center gap-3 px-4 py-2.5">
          <Link href="/dashboard" className="flex min-w-0 flex-1 items-center gap-2">
            <Image
              src={GHOST_TIMING_LOGO_WHITE}
              alt="Ghost Timing"
              width={36}
              height={36}
              className="h-8 w-auto"
              priority
            />
            <span className="text-sm font-semibold tracking-wide">CRM</span>
          </Link>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={titleId}
            onClick={() => setOpen((current) => !current)}
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-slate-200 hover:bg-white/10"
          >
            {open ? <X aria-hidden className="size-5" /> : <Menu aria-hidden className="size-5" />}
            <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
          </button>
        </div>
        <div className="border-t border-white/10 px-3 py-2">{search}</div>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-slate-950/60"
            onClick={() => setOpen(false)}
          />
          <nav
            id={titleId}
            aria-label="Mobile menu"
            className="absolute inset-y-0 right-0 flex w-[min(20rem,88vw)] flex-col bg-slate-950 text-white shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <Link href="/settings" className="min-w-0">
                <p className="font-medium">{userName}</p>
                <p className="text-xs capitalize text-slate-400">{displayRole}</p>
              </Link>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex size-10 items-center justify-center rounded-lg hover:bg-white/10"
              >
                <X aria-hidden className="size-5" />
                <span className="sr-only">Close menu</span>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-3">
              <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Work
              </p>
              {primary.map((item) => (
                <DrawerLink key={item.href} item={item} pathname={pathname} />
              ))}
              {more.length ? (
                <>
                  <p className="mt-4 px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    More
                  </p>
                  {more.map((item) => (
                    <DrawerLink key={item.href} item={item} pathname={pathname} />
                  ))}
                </>
              ) : null}
              {canAccessGoogle ? (
                <div className="mt-4 rounded-xl bg-white/5 p-2">
                  <GoogleConnectionControl variant="inline" />
                </div>
              ) : null}
            </div>
            <div className="border-t border-white/10 px-3 py-3">
              <SignOutForm label="Sign out" className="inline-flex w-full items-center justify-start gap-2 rounded-lg px-3 py-2 text-sm text-slate-200 hover:bg-white/10 hover:text-white" />
            </div>
          </nav>
        </div>
      ) : null}

      <nav
        aria-label="Mobile primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-800 bg-slate-950 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1 md:hidden"
      >
        <ul
          className="grid"
          style={{ gridTemplateColumns: `repeat(${Math.min(primary.length, 4) + 1}, minmax(0, 1fr))` }}
        >
          {primary.slice(0, 4).map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`flex flex-col items-center gap-1 px-1 py-2 text-[11px] font-medium ${
                    active ? "text-white" : "text-slate-400"
                  }`}
                >
                  <Icon aria-hidden className="size-5" />
                  {item.label}
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="flex w-full flex-col items-center gap-1 px-1 py-2 text-[11px] font-medium text-slate-400"
            >
              <Menu aria-hidden className="size-5" />
              Menu
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}

function DrawerLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const Icon = item.icon;
  const active = isActive(pathname, item);
  return (
    <Link
      href={item.href}
      className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${
        active ? "bg-white/10 font-semibold text-white" : "text-slate-200 hover:bg-white/5"
      }`}
    >
      <Icon aria-hidden className="size-4" />
      {item.label}
    </Link>
  );
}
