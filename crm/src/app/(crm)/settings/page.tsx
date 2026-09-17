import Link from "next/link";
import { UserRound } from "lucide-react";
import {
  updateGoogleAccountDefaultsAction,
  updateUserProfileAction,
} from "@/app/settings-actions";
import { EmailTemplateManager } from "@/components/email-template-manager";
import { GoogleConnectionControl } from "@/components/google/google-connection-control";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { getPool } from "@/db";
import { getAccessContext } from "@/lib/auth/server";
import { listUserEmailTemplates } from "@/lib/crm/email-templates";
import {
  GOOGLE_PUBLIC_CONNECTION_SELECT,
  type GoogleConnectionRow,
} from "@/lib/crm/google-sync";

export const metadata = { title: "Settings" };

const field = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";

export default async function SettingsPage() {
  const access = await getAccessContext();
  const googleRows = access.canAccessGoogle
    ? (
        await getPool().query<GoogleConnectionRow>(
          `${GOOGLE_PUBLIC_CONNECTION_SELECT}
           WHERE user_id = $1::uuid
           ORDER BY connected_at ASC`,
          [access.user.id],
        )
      ).rows
    : [];
  const linked = googleRows.filter((row) => row.has_offline_grant);
  const sendDefault =
    linked.find((row) => row.google_sub === access.user.defaultSendGoogleSub)?.google_sub ??
    linked[0]?.google_sub ??
    "";
  const calendarDefault =
    linked.find((row) => row.google_sub === access.user.defaultCalendarGoogleSub)?.google_sub ??
    linked[0]?.google_sub ??
    "";
  const emailTemplates = await listUserEmailTemplates(access.user.id);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wider text-cyan-700">
          Your account
        </p>
        <h1 className="mt-1 flex items-center gap-2 text-3xl font-bold text-slate-950">
          <UserRound aria-hidden className="size-8" />
          Settings
        </h1>
        <p className="mt-1 text-slate-600">
          Your name and phone are used across the CRM. Linked Google accounts can
          have separate defaults for sending email and for Calendar. Crew email
          templates live on this page too.
        </p>
      </header>

      <form
        action={updateUserProfileAction}
        className="grid gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:grid-cols-2"
      >
        <h2 className="text-lg font-bold text-slate-950 sm:col-span-2">Profile</h2>
        <label className="text-sm">
          First name
          <input
            name="firstName"
            className={field}
            defaultValue={access.user.firstName ?? ""}
            autoComplete="given-name"
          />
        </label>
        <label className="text-sm">
          Last name
          <input
            name="lastName"
            className={field}
            defaultValue={access.user.lastName ?? ""}
            autoComplete="family-name"
          />
        </label>
        <label className="text-sm sm:col-span-2">
          Phone
          <input
            name="phone"
            type="tel"
            className={field}
            defaultValue={access.user.phone ?? ""}
            autoComplete="tel"
          />
        </label>
        <p className="text-sm text-slate-500 sm:col-span-2">
          Sign-in email: <span className="font-medium text-slate-800">{access.user.email}</span>
        </p>
        <div className="flex justify-end sm:col-span-2">
          <PendingSubmitButton className="rounded-lg bg-cyan-700 px-5 py-2 text-sm font-semibold text-white">
            Save profile
          </PendingSubmitButton>
        </div>
      </form>

      <EmailTemplateManager templates={emailTemplates} />

      {access.canAccessGoogle ? (
        <section id="google" className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-bold text-slate-950">Linked Google accounts</h2>
          <p className="text-sm text-slate-600">
            Connect every mailbox you use. Then pick which one sends CRM email and
            which one owns Calendar invites, so those stop switching on you.
          </p>
          {googleRows.length ? (
            <form action={updateGoogleAccountDefaultsAction} className="space-y-4">
              <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200">
                {googleRows.map((row) => (
                  <li key={row.google_sub} className="grid gap-3 px-4 py-3 sm:grid-cols-[1fr_auto_auto]">
                    <div>
                      <p className="font-medium text-slate-950">{row.google_email}</p>
                      <p className="text-xs text-slate-500">
                        Gmail {row.gmail_status}
                        {" · "}
                        Calendar {row.calendar_status}
                        {row.calendar_summary ? ` · ${row.calendar_summary}` : ""}
                        {row.has_offline_grant ? "" : " · needs Finish Google link"}
                      </p>
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="sendGoogleSub"
                        value={row.google_sub}
                        defaultChecked={row.google_sub === sendDefault}
                        disabled={!row.has_offline_grant}
                      />
                      Default send
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="calendarGoogleSub"
                        value={row.google_sub}
                        defaultChecked={row.google_sub === calendarDefault}
                        disabled={!row.has_offline_grant}
                      />
                      Default calendar
                    </label>
                  </li>
                ))}
              </ul>
              <div className="flex justify-end">
                <PendingSubmitButton
                  className="rounded-lg bg-slate-950 px-5 py-2 text-sm font-semibold text-white"
                  disabled={!linked.length}
                >
                  Save Google defaults
                </PendingSubmitButton>
              </div>
            </form>
          ) : (
            <p className="text-sm text-slate-600">
              No lasting Google links yet. Connect Google below, then come back to
              set defaults.
            </p>
          )}
          <GoogleConnectionControl variant="inline" />
        </section>
      ) : (
        <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
          Google Gmail and Calendar are not enabled for this role.{" "}
          <Link href="/dashboard" className="font-semibold text-cyan-700">
            Back to dashboard
          </Link>
        </p>
      )}
    </div>
  );
}
