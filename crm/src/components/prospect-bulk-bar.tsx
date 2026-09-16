"use client";

import { bulkUpdateProspectsAction } from "@/app/bulk-actions";
import { DatasetBulkBar } from "@/components/dataset-bulk";
import { prospectBulkFields } from "@/lib/crm/bulk-fields";

export function ProspectBulkBar({
  users,
}: {
  users: Array<{ id: string; name: string }>;
}) {
  return (
    <DatasetBulkBar
      noun="prospects"
      fields={prospectBulkFields(users)}
      updateAction={bulkUpdateProspectsAction}
    />
  );
}
