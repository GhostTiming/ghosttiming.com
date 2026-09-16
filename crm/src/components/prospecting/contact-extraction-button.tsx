"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { CONTACT_EXTRACTION_BATCH_SIZE } from "@/lib/contact-extraction/constants";
import type { ExtractedContact } from "@/lib/contact-extraction/extract";

type Candidate = {
  race_listing_id: string;
  race_name: string;
  description_html: string;
  source_hash: string;
};

type ExtractedRecord = {
  raceListingId: string;
  sourceHash: string;
  contacts: ExtractedContact[];
};

function extractInWorker(records: Candidate[]): Promise<ExtractedRecord[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("../../workers/contact-extraction.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = (event: MessageEvent<{ records: ExtractedRecord[] }>) => {
      resolve(event.data.records);
      worker.terminate();
    };
    worker.onerror = (event) => {
      reject(new Error(event.message || "Contact extraction worker failed."));
      worker.terminate();
    };
    worker.postMessage({ records });
  });
}

export function ContactExtractionButton() {
  const router = useRouter();
  const running = useRef(false);
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "running"; processed: number; total: number; contacts: number }
    | { kind: "done"; processed: number; contacts: number }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  async function processNewLeads() {
    if (running.current) return;
    running.current = true;
    let processed = 0;
    let savedContacts = 0;
    let initialTotal = 0;

    try {
      while (true) {
        const candidateResponse = await fetch(
          `/api/contact-extraction/candidates?limit=${CONTACT_EXTRACTION_BATCH_SIZE}`,
          { cache: "no-store" },
        );
        if (!candidateResponse.ok) {
          throw new Error("Could not load races needing contact extraction.");
        }
        const batch = (await candidateResponse.json()) as {
          total: number;
          records: Candidate[];
        };
        if (initialTotal === 0) initialTotal = batch.total;
        if (batch.records.length === 0) break;

        setStatus({
          kind: "running",
          processed,
          total: Math.max(initialTotal, processed + batch.records.length),
          contacts: savedContacts,
        });
        const records = await extractInWorker(batch.records);
        const saveResponse = await fetch("/api/contact-extraction", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ records }),
        });
        if (!saveResponse.ok) {
          const message = await saveResponse.text();
          throw new Error(message || "Could not save extracted contacts.");
        }
        const saved = (await saveResponse.json()) as {
          processed: number;
          savedContacts: number;
        };
        processed += saved.processed;
        savedContacts += saved.savedContacts;
        setStatus({
          kind: "running",
          processed,
          total: Math.max(initialTotal, processed),
          contacts: savedContacts,
        });
      }
      setStatus({ kind: "done", processed, contacts: savedContacts });
      router.refresh();
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Contact extraction failed.",
      });
    } finally {
      running.current = false;
    }
  }

  const isRunning = status.kind === "running";
  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <button
        type="button"
        onClick={processNewLeads}
        disabled={isRunning}
        className="inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-cyan-700 disabled:cursor-wait disabled:opacity-70"
      >
        <span className={isRunning ? "animate-spin" : ""}>
          <RefreshCw aria-hidden className="size-4" />
        </span>
        {isRunning ? "Updating prospect data…" : "Process New Leads"}
      </button>
      <p className="min-h-5 text-xs text-slate-600" aria-live="polite">
        {status.kind === "running"
          ? `${status.processed} / ${status.total} races · ${status.contacts} contacts`
          : status.kind === "done"
            ? status.processed
              ? `Done: ${status.processed} races · ${status.contacts} contacts`
              : "Everything is already up to date."
            : status.kind === "error"
              ? status.message
              : "Runs in this browser and saves results to Neon."}
      </p>
    </div>
  );
}
