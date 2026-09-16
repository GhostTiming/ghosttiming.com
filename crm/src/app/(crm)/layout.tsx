import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { getPool } from "@/db";
import { displayAccessRole } from "@/lib/auth/access";
import { getAccessContext } from "@/lib/auth/server";
import type { GoogleConnectionRow } from "@/lib/crm/google-sync";

export const dynamic = "force-dynamic";

export default async function CrmLayout({ children }: { children: ReactNode }) {
  const access = await getAccessContext();
  const connections = await getPool().query<GoogleConnectionRow>(
    `
      SELECT id::text, user_id::text, google_sub, google_email, gmail_history_id,
             gmail_last_synced_at::text, gmail_backfill_completed_at::text,
             gmail_status::text, gmail_last_error, calendar_id, calendar_summary,
             calendar_status::text, calendar_last_error,
             calendar_last_synced_at::text
      FROM crm.google_connections
      WHERE user_id = $1::uuid
      ORDER BY connected_at ASC
    `,
    [access.user.id],
  );
  return (
    <AppShell
      user={access.user}
      displayRole={displayAccessRole(access)}
      canAccessOperations={access.canAccessOperations}
      canAccessProspecting={access.canAccessProspecting}
      canAccessTasks={access.canAccessTasks}
      canAccessGoogle={access.canAccessGoogle}
      canAccessAdminConsole={access.canAccessAdminConsole}
      viewingAs={
        access.viewingAs
          ? { email: access.viewingAs.email, role: displayAccessRole(access) }
          : null
      }
      googleClientId={process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? ""}
      googleConnections={connections.rows}
    >
      {children}
    </AppShell>
  );
}
