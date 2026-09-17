import type { ReactNode } from "react";

export function LeadProfileLayout({
  header,
  contacts,
  glance,
  race,
  log,
  email,
  timeline,
  footer,
}: {
  header: ReactNode;
  contacts: ReactNode;
  glance: ReactNode;
  race: ReactNode;
  log: ReactNode;
  email: ReactNode;
  timeline: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="space-y-4 md:space-y-5">
      {header}
      {contacts}
      {glance}
      {race}
      {log}
      {email}
      {timeline}
      {footer}
    </div>
  );
}
