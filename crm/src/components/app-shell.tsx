import { stopViewAsUserAction } from "@/app/admin-actions";
import { GlobalSearch } from "@/components/global-search";
import { GoogleConnectionControl } from "@/components/google/google-connection-control";
import { GoogleSessionProvider } from "@/components/google/google-session-provider";
import { HeaderMoreNav } from "@/components/header-more-nav";
import { MobileShell } from "@/components/mobile-shell";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { SignOutForm } from "@/components/sign-out-form";
import {
  BriefcaseBusiness,
  ClipboardList,
  LayoutDashboard,
  Search,
  Shield,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import type { CrmUser } from "@/db/schema";
import { GHOST_TIMING_LOGO_WHITE } from "@/lib/branding";
import type { GoogleConnectionRow } from "@/lib/crm/google-sync";

export function AppShell({
  user,
  displayRole,
  canAccessOperations,
  canAccessProspecting,
  canAccessTasks,
  canAccessGoogle,
  canAccessAdminConsole,
  viewingAs,
  googleClientId,
  googleConnections,
  children,
}: {
  user: CrmUser;
  displayRole: string;
  canAccessOperations: boolean;
  canAccessProspecting: boolean;
  canAccessTasks: boolean;
  canAccessGoogle: boolean;
  canAccessAdminConsole: boolean;
  viewingAs: { email: string; role: string } | null;
  googleClientId: string;
  googleConnections: GoogleConnectionRow[];
  children: ReactNode;
}) {
  return (
    <GoogleSessionProvider
      clientId={googleClientId}
      userId={user.id}
      initialConnections={googleConnections}
    >
    <div className="min-h-screen min-w-0 overflow-x-clip bg-slate-100">
      <header className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950 text-white">
        <div className="mx-auto hidden max-w-screen-2xl items-center gap-x-3 px-6 py-3 md:flex">
          <Link href="/dashboard" className="flex shrink-0 items-center gap-2">
            <Image
              src={GHOST_TIMING_LOGO_WHITE}
              alt="Ghost Timing"
              width={40}
              height={40}
              className="h-9 w-auto"
              priority
            />
            <span className="text-sm font-semibold tracking-wide">CRM</span>
          </Link>
          <nav className="flex shrink-0 items-center gap-1" aria-label="Main navigation">
            <Link
              href="/dashboard"
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-200 hover:bg-white/10"
            >
              <LayoutDashboard aria-hidden className="size-4" />
              Dashboard
            </Link>
            {canAccessOperations ? (
              <Link
                href="/bookings"
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-200 hover:bg-white/10"
              >
                <BriefcaseBusiness aria-hidden className="size-4" />
                Bookings
              </Link>
            ) : null}
            {canAccessProspecting ? (
              <Link
                href="/prospecting"
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-200 hover:bg-white/10"
              >
                <Search aria-hidden className="size-4" />
                Prospecting
              </Link>
            ) : null}
            {canAccessTasks ? (
              <Link
                href="/tasks"
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-200 hover:bg-white/10"
              >
                <ClipboardList aria-hidden className="size-4" />
                Tasks
              </Link>
            ) : null}
            <HeaderMoreNav
              canAccessOperations={canAccessOperations}
              canAccessProspecting={canAccessProspecting}
            />
            {canAccessAdminConsole ? (
              <Link
                href="/admin"
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-200 hover:bg-white/10"
              >
                <Shield aria-hidden className="size-4" />
                Admin
              </Link>
            ) : null}
          </nav>
          <GlobalSearch />
          <div className="ml-auto hidden text-right text-sm lg:block">
            <p className="font-medium">{user.name}</p>
            <p className="text-xs capitalize text-slate-400">{displayRole}</p>
          </div>
          {canAccessGoogle ? <GoogleConnectionControl /> : null}
          <SignOutForm />
        </div>
        <MobileShell
          userName={user.name}
          displayRole={displayRole}
          canAccessOperations={canAccessOperations}
          canAccessProspecting={canAccessProspecting}
          canAccessTasks={canAccessTasks}
          canAccessGoogle={canAccessGoogle}
          canAccessAdminConsole={canAccessAdminConsole}
          search={<GlobalSearch />}
        />
      </header>
      {viewingAs ? (
        <div className="border-b border-amber-300 bg-amber-100 text-amber-950" role="status">
          <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center justify-between gap-3 px-4 py-2 sm:px-6">
            <p className="text-sm">
              Viewing as <span className="font-semibold">{viewingAs.email}</span>
              {" "}({viewingAs.role})
            </p>
            <form action={stopViewAsUserAction}>
              <PendingSubmitButton
                className="rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white"
                pendingLabel="Exiting…"
              >
                Exit view
              </PendingSubmitButton>
            </form>
          </div>
        </div>
      ) : null}
      <main className="mx-auto min-w-0 max-w-screen-2xl overflow-x-clip px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-6">
        {children}
      </main>
    </div>
    </GoogleSessionProvider>
  );
}
