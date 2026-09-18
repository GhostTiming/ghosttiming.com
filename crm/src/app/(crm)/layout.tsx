import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { getPool } from "@/db";
import { displayAccessRole } from "@/lib/auth/access";
import { getAccessContext } from "@/lib/auth/server";
import {
  countPendingCadenceSends,
  processCadenceReplies,
} from "@/lib/crm/cadence";
import {
  GOOGLE_PUBLIC_CONNECTION_SELECT,
  type GoogleConnectionRow,
} from "@/lib/crm/google-sync";

export const dynamic = "force-dynamic";

export default async function CrmLayout({ children }: { children: ReactNode }) {
  const access = await getAccessContext();
  const connections = await getPool().query<GoogleConnectionRow>(
    `${GOOGLE_PUBLIC_CONNECTION_SELECT}
     WHERE user_id = $1::uuid
     ORDER BY connected_at ASC`,
    [access.user.id],
  );
  let pendingCadenceCount = 0;
  if (access.canAccessProspecting) {
    try {
      await processCadenceReplies();
      pendingCadenceCount = await countPendingCadenceSends({
        userId: access.user.id,
        includeUnassigned: access.isSuperAdmin,
      });
    } catch {
      pendingCadenceCount = 0;
    }
  }
  return (
    <AppShell
      user={access.user}
      displayRole={displayAccessRole(access)}
      canAccessOperations={access.canAccessOperations}
      canAccessProspecting={access.canAccessProspecting}
      canAccessTasks={access.canAccessTasks}
      canAccessGoogle={access.canAccessGoogle}
      canAccessAdminConsole={access.canAccessAdminConsole}
      pendingCadenceCount={pendingCadenceCount}
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
