"use client";

import type { MouseEvent, ReactNode } from "react";
import { parseAddressList } from "@/lib/google/email-match";

export function mailtoHref(email: string) {
  return `mailto:${email.trim()}`;
}

export function MailtoLink({
  email,
  className,
  children,
}: {
  email: string;
  className?: string;
  children?: ReactNode;
}) {
  const trimmed = email.trim();
  if (!trimmed) return null;
  return (
    <a
      href={mailtoHref(trimmed)}
      className={`relative z-10 ${className ?? ""}`.trim()}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => event.stopPropagation()}
    >
      {children ?? trimmed}
    </a>
  );
}

export function ExternalHref({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={className}>
      {children}
    </a>
  );
}

export function AddressListMailto({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const parsed = parseAddressList(value);
  if (!parsed.length) return value;
  return (
    <>
      {parsed.map((item, index) => (
        <span key={`${item.email}-${index}`}>
          {index > 0 ? ", " : null}
          {item.name ? `${item.name} ` : null}
          <MailtoLink email={item.email} className={className} />
        </span>
      ))}
    </>
  );
}
