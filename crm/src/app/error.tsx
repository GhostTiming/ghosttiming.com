"use client";

function displayErrorMessage(error: Error) {
  if (/minified react error #441/i.test(error.message)) {
    return "The last save could not finish. Try again, or complete the required fields first.";
  }
  return error.message || "Try again, or go back to the dashboard.";
}

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-4 py-12">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wider text-cyan-700">
          Something went wrong
        </p>
        <h1 className="mt-2 text-2xl font-bold text-slate-950">
          The CRM hit an error
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          {displayErrorMessage(error)}
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white"
          >
            Try again
          </button>
          <a
            href="/dashboard"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800"
          >
            Dashboard
          </a>
        </div>
      </section>
    </main>
  );
}
