"use client";

import { bulkUpdateCandidatesAction, bulkUpdateProspectsAction } from "@/app/bulk-actions";
import { DatasetBulkBar, type BulkExtraAction } from "@/components/dataset-bulk";
import { candidateBulkFields, prospectBulkFields } from "@/lib/crm/bulk-fields";

export function ProspectBulkBar({
  users,
  extraActions = [],
  mode = "prospects",
}: {
  extraActions?: BulkExtraAction[];
  users: Array<{ id: string; name: string }>;
  mode?: "prospects" | "candidates";
}) {
  if (mode === "candidates") {
    return (
      <DatasetBulkBar
        noun="leads"
        fields={candidateBulkFields()}
        extraActions={extraActions}
        updateAction={bulkUpdateCandidatesAction}
      />
    );
  }
  return (
    <DatasetBulkBar
      noun="prospects"
      fields={prospectBulkFields(users)}
      extraActions={extraActions}
      updateAction={bulkUpdateProspectsAction}
    />
  );
}
