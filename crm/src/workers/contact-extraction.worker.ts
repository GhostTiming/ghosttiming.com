/// <reference lib="webworker" />

import { extractContacts } from "@/lib/contact-extraction/extract";

type Candidate = {
  race_listing_id: string;
  source_hash: string;
  description_html: string;
};

type WorkerRequest = {
  records: Candidate[];
};

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const records = event.data.records.map((record) => ({
    raceListingId: record.race_listing_id,
    sourceHash: record.source_hash,
    contacts: extractContacts(record.description_html),
  }));
  self.postMessage({ records });
};

export {};
