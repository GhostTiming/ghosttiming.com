"use client";

import {
  refreshSelectedBookingsFromCatalogAction,
  bulkUpdateBookingsAction,
} from "@/app/bulk-actions";
import { DatasetBulkBar } from "@/components/dataset-bulk";
import { bookingBulkFields } from "@/lib/crm/bulk-fields";

export function BookingBulkBar({
  stages,
  users,
}: {
  stages: Array<{ key: string; name: string }>;
  users: Array<{ id: string; name: string }>;
}) {
  return (
    <DatasetBulkBar
      noun="bookings"
      fields={bookingBulkFields(stages, users)}
      updateAction={bulkUpdateBookingsAction}
      extraActions={[
        {
          key: "grv_refresh",
          label: "Refresh from Get Run Vibes",
          pendingLabel: "Refreshing…",
          confirm:
            "Refresh Get Run Vibes data for {n} selected bookings? This can take a while.",
          action: (ids) => refreshSelectedBookingsFromCatalogAction({ ids }),
        },
      ]}
    />
  );
}
