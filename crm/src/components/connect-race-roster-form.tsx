"use client";

import { useState, useTransition } from "react";
import {
  connectRaceRosterAccountAction,
  type ConnectRaceRosterActionResult,
} from "@/app/race-roster-connect-actions";

const field = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";

export function ConnectRaceRosterForm({ hasAccount }: { hasAccount: boolean }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ConnectRaceRosterActionResult | null>(null);

  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(async () => {
          const outcome = await connectRaceRosterAccountAction(formData);
          setResult(outcome);
          if (outcome.ok) event.currentTarget.reset();
        });
      }}
    >
      <label className="text-sm">
        Timer account email
        <input
          name="username"
          type="email"
          required
          autoComplete="username"
          className={field}
          placeholder="timer@example.com"
        />
      </label>
      <label className="text-sm">
        Password
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className={field}
        />
      </label>
      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {pending
            ? "Connecting…"
            : hasAccount
              ? "Reconnect Race Roster"
              : "Connect Race Roster"}
        </button>
      </div>
      {result ? (
        <p
          className={`text-sm sm:col-span-2 ${result.ok ? "text-emerald-800" : "text-red-700"}`}
          role="status"
        >
          {result.message}
        </p>
      ) : null}
    </form>
  );
}