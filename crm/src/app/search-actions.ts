"use server";

import { z } from "zod";
import { getAccessContext } from "@/lib/auth/server";
import { searchCrmRecords } from "@/lib/crm/global-search-queries";

export async function searchCrmAction(query: string) {
  const access = await getAccessContext();
  const search = z.string().max(200).parse(query);
  return searchCrmRecords(access, search);
}
