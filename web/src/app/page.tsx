import Link from "next/link";

/** Fallback when middleware does not rewrite `/` (e.g. local oddities). */
export default function Home() {
  return (
    <main className="mx-auto flex max-w-lg flex-col gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">
        Ghost Timing
      </h1>
      <p className="text-sm text-muted">
        If you expected the marketing homepage, open{" "}
        <Link href="/ghost-home.html" className="text-accent underline">
          ghost-home.html
        </Link>
        , or go to{" "}
        <Link href="/timing" className="text-accent underline">
          Chip Streamer / live timing
        </Link>
        .
      </p>
    </main>
  );
}
