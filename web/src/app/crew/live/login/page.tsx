"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function CrewLiveLoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/crew/live/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "Wrong password.");
      }
      router.replace("/crew/live");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8">
      <form
        onSubmit={(e) => void onSubmit(e)}
        className="w-full max-w-md rounded-xl border border-border bg-card p-6"
      >
        <p className="text-xs uppercase tracking-[0.18em] text-muted">Ghost Timing</p>
        <h1 className="mt-1 text-3xl font-semibold">Crew live</h1>
        <p className="mt-2 text-base text-muted">
          Enter the race-day password, then pick your event.
        </p>
        <label className="mt-6 block text-sm text-muted">
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-2 min-h-12 w-full rounded-md border border-border bg-background px-3 py-3 text-lg text-foreground"
            autoComplete="current-password"
            autoFocus
          />
        </label>
        {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}
        <button
          type="submit"
          disabled={busy}
          className="mt-6 min-h-12 w-full rounded-md bg-accent px-3 py-3 text-lg font-medium text-white disabled:opacity-60"
        >
          {busy ? "Opening…" : "Open my event"}
        </button>
      </form>
    </div>
  );
}
