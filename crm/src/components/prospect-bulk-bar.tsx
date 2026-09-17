"use client";

import { bulkUpdateCandidatesAction, bulkUpdateProspectsAction } from "@/app/bulk-actions";
import { DatasetBulkBar } from "@/components/dataset-bulk";
import { candidateBulkFields, prospectBulkFields } from "@/lib/crm/bulk-fields";

export function ProspectBulkBar({
  users,
  mode = "prospects",
}: {
  users: Array<{ id: string; name: string }>;
  mode?: "prospects" | "candidates";
}) {
  if (mode === "candidates") {
    return (
      <DatasetBulkBar
        noun="leads"
        fields={candidateBulkFields()}
        updateAction={bulkUpdateCandidatesAction}
      />
    );
  }
  return (
    <DatasetBulkBar
      noun="prospects"
      fields={prospectBulkFields(users)}
      updateAction={bulkUpdateProspectsAction}
    />
  );
}
