"use client";

import { Loader2 } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

function isInternalNavigationClick(event: MouseEvent) {
  if (event.defaultPrevented) return false;
  if (event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return false;
  }
  const anchor = (event.target as HTMLElement | null)?.closest("a");
  if (!anchor) return false;
  if (anchor.getAttribute("aria-disabled") === "true") return false;
  if (anchor.hasAttribute("download")) return false;
  const target = anchor.getAttribute("target");
  if (target && target !== "_self") return false;
  const href = anchor.getAttribute("href");
  if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
    return false;
  }
  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin) return false;
  return (
    url.pathname !== window.location.pathname ||
    url.search !== window.location.search
  );
}

function NavigationProgressInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, setPending] = useState(false);
  const locationKey = `${pathname}?${searchParams.toString()}`;
  const [seenLocation, setSeenLocation] = useState(locationKey);
  if (seenLocation !== locationKey) {
    setSeenLocation(locationKey);
    setPending(false);
  }

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (isInternalNavigationClick(event)) setPending(true);
    }
    function onSubmit(event: SubmitEvent) {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (form.method.toLowerCase() === "dialog") return;
      const action = form.getAttribute("action") ?? window.location.pathname;
      if (action.startsWith("http") && !action.startsWith(window.location.origin)) {
        return;
      }
      setPending(true);
    }
    function onNavigate() {
      setPending(true);
    }
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    window.addEventListener("crm:navigate", onNavigate as EventListener);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
      window.removeEventListener("crm:navigate", onNavigate as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!pending) return;
    const timeout = window.setTimeout(() => setPending(false), 15_000);
    return () => window.clearTimeout(timeout);
  }, [pending]);

  if (!pending) return null;

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/25"
      role="status"
      aria-live="polite"
      aria-label="Loading"
    >
      <div className="absolute inset-x-0 top-0 h-1 overflow-hidden bg-cyan-950">
        <div className="h-full w-1/3 animate-[navigation-progress_1s_ease-in-out_infinite] bg-cyan-400" />
      </div>
      <div className="flex items-center gap-3 rounded-2xl bg-white px-5 py-4 text-sm font-semibold text-slate-800 shadow-xl">
        <Loader2 aria-hidden className="size-5 animate-spin text-cyan-700" />
        Loading…
      </div>
    </div>
  );
}

export function NavigationProgress() {
  return (
    <Suspense fallback={null}>
      <NavigationProgressInner />
    </Suspense>
  );
}
