"use server";

import { z } from "zod";
import { requireCrmUser } from "@/lib/auth/server";
import { searchOnlineListings } from "@/lib/crm/online-listings";

export async function searchCatalogListingsAction(query: string) {
  await requireCrmUser();
  const search = z.string().trim().max(500).parse(query);
  return searchOnlineListings(search);
}
