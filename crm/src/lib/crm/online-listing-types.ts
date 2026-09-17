import type { CatalogListingCandidate } from "./catalog-link";

export type OnlineListingSource = "catalog" | "runsignup";

export type OnlineListing = CatalogListingCandidate & {
  source: OnlineListingSource;
  source_label: string;
  registration_url?: string | null;
};
