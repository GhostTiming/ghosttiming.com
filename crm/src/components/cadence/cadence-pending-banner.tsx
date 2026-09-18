import Link from "next/link";
import { Mail } from "lucide-react";

export function CadencePendingBanner({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <div className="border-b border-cyan-300 bg-cyan-50 text-cyan-950" role="status">
      <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center justify-between gap-3 px-4 py-2 sm:px-6">
        <p className="inline-flex items-center gap-2 text-sm">
          <Mail aria-hidden className="size-4" />
          You have {count} pending cadence {count === 1 ? "email" : "emails"} — review now.
        </p>
        <Link
          href="/prospecting/pending-emails"
          className="rounded-lg bg-cyan-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-800"
        >
          Review now
        </Link>
      </div>
    </div>
  );
}
