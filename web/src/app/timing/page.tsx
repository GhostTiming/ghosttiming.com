import Link from "next/link";

export default function TimingHubPage() {
  return (
    <main className="mx-auto flex max-w-lg flex-col gap-6 px-6 py-16">
      <p className="text-xs uppercase tracking-wide text-muted">
        Ghost Timing · Chip Streamer
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">
        Live timing for remote viewers
      </h1>
      <p className="text-sm text-muted">
        Race crews publish a share link from the Chip Streamer desktop app.
        Viewers open{" "}
        <code className="rounded bg-card px-1 py-0.5 text-foreground">
          /e/&lt;shortId&gt;
        </code>{" "}
        (with the password your crew shares). There is no public directory of
        events—each organization uses its own link.
      </p>
      <div className="flex flex-col gap-3 text-sm">
        <Link
          href="/"
          className="text-accent underline underline-offset-4"
        >
          ← Ghost Timing marketing site
        </Link>
        <Link
          href="/api/health"
          className="text-muted underline underline-offset-4"
        >
          API health check
        </Link>
      </div>
    </main>
  );
}
