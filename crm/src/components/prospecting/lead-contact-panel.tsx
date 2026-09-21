import { Mail, Phone, Plus } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  removeProspectContactMethodAction,
  saveProspectContactMethodAction,
} from "@/app/prospect-actions";
import { MailtoLink } from "@/components/crm-links";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { leadContactIdentity } from "@/lib/crm/contacts";
import type { ContactMethodRow } from "@/lib/crm/queries";

function telHref(value: string) {
  const trimmed = value.trim();
  const digits = trimmed.replace(/[^\d+]/g, "");
  return digits ? `tel:${digits}` : undefined;
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function normalizePhone(value: string) {
  return value.replace(/\D/g, "");
}

function valuesMatch(left: string, right: string, type: "email" | "phone") {
  if (type === "email") return normalizeEmail(left) === normalizeEmail(right);
  const leftDigits = normalizePhone(left);
  const rightDigits = normalizePhone(right);
  return Boolean(leftDigits) && leftDigits === rightDigits;
}

function joinLine(parts: ReactNode[]) {
  return parts.flatMap((part, index) =>
    index === 0
      ? [part]
      : [
          <span key={`sep-${index}`} className="text-slate-400">
            {" · "}
          </span>,
          part,
        ],
  );
}

export type LeadContactPerson = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  email: string | null;
  phone: string | null;
};

export function LeadContactPanel({
  prospectId,
  contacts,
  person,
}: {
  prospectId: string;
  contacts: ContactMethodRow[];
  person?: LeadContactPerson | null;
}) {
  const emails = contacts.filter((contact) => contact.type === "email");
  const phones = contacts.filter((contact) => contact.type === "phone");
  const primaryEmail =
    emails.find((contact) => contact.is_primary) ?? emails[0] ?? null;
  const primaryPhone =
    phones.find((contact) => contact.is_primary) ?? phones[0] ?? null;
  const identity = leadContactIdentity({
    person,
    email: primaryEmail?.raw_value,
    phone: primaryPhone?.raw_value,
  });
  const extraContacts = contacts.filter((contact) => {
    if (
      contact.type === "email" &&
      identity.email &&
      valuesMatch(identity.email, contact.raw_value, "email")
    ) {
      return false;
    }
    if (
      contact.type === "phone" &&
      identity.phone &&
      valuesMatch(identity.phone, contact.raw_value, "phone")
    ) {
      return false;
    }
    return true;
  });
  const lineParts: ReactNode[] = [];
  if (identity.name && person) {
    lineParts.push(
      <Link
        key="name"
        href={`/contacts/${person.id}`}
        className="font-semibold text-cyan-700 hover:text-cyan-900"
      >
        {identity.name}
      </Link>,
    );
  } else if (identity.name) {
    lineParts.push(
      <span key="name" className="font-semibold text-slate-950">
        {identity.name}
      </span>,
    );
  }
  if (identity.email) {
    lineParts.push(
      <MailtoLink
        key="email"
        email={identity.email}
        className="font-medium text-cyan-700 hover:text-cyan-900"
      />,
    );
  }
  if (identity.phone) {
    const href = telHref(identity.phone);
    lineParts.push(
      href ? (
        <a
          key="phone"
          href={href}
          className="font-medium text-cyan-700 hover:text-cyan-900"
        >
          {identity.phone}
        </a>
      ) : (
        <span key="phone" className="font-medium text-slate-800">
          {identity.phone}
        </span>
      ),
    );
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
        Contact
      </h2>
      {lineParts.length ? (
        <p className="mt-3 text-sm leading-6">{joinLine(lineParts)}</p>
      ) : (
        <p className="mt-2 text-sm text-slate-500">No phone or email yet.</p>
      )}

      {extraContacts.length ? (
        <ul className="mt-3 space-y-1">
          {extraContacts.map((contact) => (
            <li key={`${contact.id}-${contact.type}`}>
              <details className="rounded-lg bg-slate-50 px-2.5 py-2 text-sm">
                <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
                  {contact.type === "email" ? (
                    <Mail aria-hidden className="size-3.5 shrink-0 text-slate-400" />
                  ) : (
                    <Phone aria-hidden className="size-3.5 shrink-0 text-slate-400" />
                  )}
                  {contact.type === "email" ? (
                    <MailtoLink
                      email={contact.raw_value}
                      className="min-w-0 truncate font-medium text-cyan-700 hover:text-cyan-900"
                    />
                  ) : (
                    <a
                      href={telHref(contact.raw_value)}
                      className="min-w-0 truncate font-medium text-cyan-700 hover:text-cyan-900"
                    >
                      {contact.raw_value}
                    </a>
                  )}
                  {contact.label ? (
                    <span className="shrink-0 text-xs text-slate-500">({contact.label})</span>
                  ) : null}
                  {contact.is_primary ? (
                    <span className="ml-auto shrink-0 rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                      Primary
                    </span>
                  ) : null}
                </summary>
                {contact.editable ? (
                  <div className="mt-2 space-y-2 border-t border-slate-200 pt-2">
                    <form action={saveProspectContactMethodAction} className="space-y-2">
                      <input type="hidden" name="prospectId" value={prospectId} />
                      <input type="hidden" name="contactMethodId" value={contact.id} />
                      <label className="block text-xs font-medium">
                        Type
                        <select
                          name="type"
                          defaultValue={contact.type}
                          className="mt-1 w-full rounded-lg border px-2 py-1 text-sm"
                        >
                          <option value="email">Email</option>
                          <option value="phone">Phone</option>
                        </select>
                      </label>
                      <label className="block text-xs font-medium">
                        Value
                        <input
                          required
                          name="value"
                          defaultValue={contact.raw_value}
                          className="mt-1 w-full rounded-lg border px-2 py-1 text-sm"
                        />
                      </label>
                      <label className="block text-xs font-medium">
                        Label
                        <input
                          name="label"
                          defaultValue={contact.label ?? ""}
                          className="mt-1 w-full rounded-lg border px-2 py-1 text-sm"
                        />
                      </label>
                      <label className="block text-xs font-medium">
                        Status
                        <select
                          name="status"
                          defaultValue={contact.status}
                          className="mt-1 w-full rounded-lg border px-2 py-1 text-sm"
                        >
                          <option value="unknown">Unknown</option>
                          <option value="valid">Valid</option>
                          <option value="invalid">Invalid</option>
                          <option value="opted_out">Opted out</option>
                        </select>
                      </label>
                      <label className="flex gap-2 text-xs font-medium">
                        <input type="checkbox" name="isPrimary" defaultChecked={contact.is_primary} />
                        Primary
                      </label>
                      <PendingSubmitButton className="font-semibold text-cyan-700 disabled:opacity-60">
                        Save contact method
                      </PendingSubmitButton>
                    </form>
                    <form action={removeProspectContactMethodAction}>
                      <input type="hidden" name="prospectId" value={prospectId} />
                      <input type="hidden" name="contactMethodId" value={contact.id} />
                      <button className="text-xs font-semibold text-red-700">Remove</button>
                    </form>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-slate-500">
                    Edit this person from their organization record.
                  </p>
                )}
              </details>
            </li>
          ))}
        </ul>
      ) : null}

      <details className="mt-3 rounded-lg border border-dashed border-slate-300 p-2.5 text-sm">
        <summary className="flex cursor-pointer items-center gap-1.5 font-semibold text-cyan-700">
          <Plus aria-hidden className="size-4" />
          Add contact method
        </summary>
        <form action={saveProspectContactMethodAction} className="mt-3 space-y-2">
          <input type="hidden" name="prospectId" value={prospectId} />
          <label className="block text-xs font-medium">
            Type
            <select name="type" className="mt-1 w-full rounded-lg border px-2 py-1 text-sm">
              <option value="email">Email</option>
              <option value="phone">Phone</option>
            </select>
          </label>
          <label className="block text-xs font-medium">
            Value
            <input required name="value" className="mt-1 w-full rounded-lg border px-2 py-1 text-sm" />
          </label>
          <label className="block text-xs font-medium">
            Label
            <input name="label" className="mt-1 w-full rounded-lg border px-2 py-1 text-sm" />
          </label>
          <input type="hidden" name="status" value="unknown" />
          <label className="flex gap-2 text-xs font-medium">
            <input type="checkbox" name="isPrimary" /> Primary
          </label>
          <PendingSubmitButton className="font-semibold text-cyan-700 disabled:opacity-60">
            Add
          </PendingSubmitButton>
        </form>
      </details>
    </section>
  );
}
