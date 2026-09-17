import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { getPool } from "@/db";
import { displayAccessRole } from "@/lib/auth/access";
import { getAccessContext } from "@/lib/auth/server";
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
