"use client";

import { signOutAction } from "@/app/actions";
import { LogOut } from "lucide-react";

export function SignOutForm({
  label,
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        title="Sign out"
        className={
          className ??
          "inline-flex items-center rounded-lg p-2 text-slate-300 hover:bg-white/10 hover:text-white"
        }
      >
        <LogOut aria-hidden className="size-4" />
        {label ? <span>{label}</span> : <span className="sr-only">Sign out</span>}
      </button>
    </form>
  );
}
