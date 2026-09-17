"use server";

import { z } from "zod";
import { getPool } from "@/db";
import { requireCrmUser } from "@/lib/auth/server";
import {
  asCatalogQuery,
  loadCatalogListingCandidates,
} from "@/lib/crm/catalog-link";
import {
  catalogSearchIdNeedle,
  catalogSearchLikeNeedles,
} from "@/lib/crm/catalog-search";

export async function searchCatalogListingsAction(query: string) {
  await requireCrmUser();
  const search = z.string().trim().max(200).parse(query);
  if (!catalogSearchIdNeedle(search) && !catalogSearchLikeNeedles(search).length) {
    return [];
  }
  const context = await loadCatalogListingCandidates(
    asCatalogQuery((sql, params) => getPool().query(sql, params)),
    { search },
  );
  // Keep already-linked listings visible so id/slug searches still surface them.
  return context.listings;
}
