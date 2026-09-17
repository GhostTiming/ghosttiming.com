import { Mail, Phone, Plus } from "lucide-react";
import {
  removeProspectContactMethodAction,
  saveProspectContactMethodAction,
} from "@/app/prospect-actions";
import { MailtoLink } from "@/components/crm-links";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import type { ContactMethodRow } from "@/lib/crm/queries";

function telHref(value: string) {
  const trimmed = value.trim();
  const digits = trimmed.replace(/[^\d+]/g, "");
  return digits ? `tel:${digits}` : undefined;
}

export function LeadContactPanel({
  prospectId,
  contacts,
}: {
  prospectId: string;
  contacts: ContactMethodRow[];
}) {
  const emails = contacts.filter((contact) => contact.type === "email");
  const phones = contacts.filter((contact) => contact.type === "phone");
  const primaryEmail =
    emails.find((contact) => contact.is_primary) ?? emails[0] ?? null;
  const primaryPhone =
    phones.find((contact) => contact.is_primary) ?? phones[0] ?? null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
        Contact
      </h2>
      {primaryPhone || primaryEmail ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {primaryPhone ? (
            <a
              href={telHref(primaryPhone.raw_value)}
              className="inline-flex min-h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg bg-cyan-700 px-3 text-sm font-semibold text-white hover:bg-cyan-800"
            >
              <Phone aria-hidden className="size-4 shrink-0" />
              <span className="truncate">{primaryPhone.raw_value}</span>
            </a>
          ) : null}
          {primaryEmail ? (
            <MailtoLink
              email={primaryEmail.raw_value}
              className="inline-flex min-h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              <Mail aria-hidden className="size-4 shrink-0" />
              <span className="truncate">{primaryEmail.raw_value}</span>
            </MailtoLink>
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-sm text-slate-500">No phone or email yet.</p>
      )}

      <ul className="mt-3 space-y-1">
        {contacts.map((contact) => (
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
