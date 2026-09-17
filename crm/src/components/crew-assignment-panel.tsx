"use client";

import { useState } from "react";
import Link from "next/link";
import {
  addCrewAssignmentAction,
  createCrewMemberAction,
  deleteCrewAssignmentAction,
  saveCrewAssignmentAction,
} from "@/app/operations-actions";
import { MailtoLink } from "@/components/crm-links";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { CrewEmailPanel } from "@/components/crew-email-panel";
import { filterCrewSearchResults } from "@/lib/crm/crew";
import { formatRecipientField } from "@/lib/crm/email-compose";
import type { EmailTemplateSummary } from "@/lib/crm/email-templates";

export type CrewPersonOption = {
  id: string;
  displayName: string;
  firstName?: string | null;
  lastName?: string | null;
  email: string | null;
  phone: string | null;
};

export type AssignedCrewMember = {
  id: string;
  personId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  freeformName: string | null;
  notes: string | null;
};

function ContactTileBody({
  name,
  email,
  phone,
  role,
}: {
  name: string;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
}) {
  return (
    <>
      <p className="font-semibold text-slate-950">{name}</p>
      {role ? <p className="text-xs font-medium text-cyan-800">{role}</p> : null}
      <p className="mt-1 text-sm text-slate-600">
        {email ? (
          <MailtoLink email={email} className="text-cyan-700 underline hover:text-cyan-900" />
        ) : (
          "No email"
        )}
      </p>
      <p className="text-sm text-slate-600">{phone || "No phone"}</p>
    </>
  );
}

export function CrewAssignmentPanel({
  bookingId,
  occurrenceId,
  assigned,
  people,
  clientOrganizationId,
  clientOrganizationName,
  emailTemplates,
}: {
  bookingId: string;
  occurrenceId: string;
  assigned: AssignedCrewMember[];
  people: CrewPersonOption[];
  clientOrganizationId: string;
  clientOrganizationName: string;
  emailTemplates: EmailTemplateSummary[];
}) {
  const [query, setQuery] = useState("");
  const [addingMember, setAddingMember] = useState(false);
  const assignedPersonIds = assigned.flatMap((member) =>
    member.personId ? [member.personId] : [],
  );
  const matches = filterCrewSearchResults(people, query, {
    assignedPersonIds,
    organizationName: clientOrganizationName,
  });
  const editPeople = [...people];
  for (const member of assigned) {
    if (
      member.personId &&
      !editPeople.some((person) => person.id === member.personId)
    ) {
      editPeople.push({
        id: member.personId,
        displayName: member.name,
        email: member.email,
        phone: member.phone,
      });
    }
  }

  return (
    <div className="space-y-4">
      <CrewEmailPanel
        bookingId={bookingId}
        templates={emailTemplates}
        defaultTo={formatRecipientField(
          assigned.flatMap((member) => (member.email ? [member.email] : [])),
        )}
      />
      <p className="text-sm text-slate-500">
        Search crew tagged to {clientOrganizationName}. Known contacts with an
        email are invited when this booking syncs to Google Calendar. Inactive
        people are hidden from search.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {assigned.map((member) => (
          <article
            key={member.id}
            className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm"
          >
            <ContactTileBody
              name={member.name}
              email={member.email}
              phone={member.phone}
              role={member.role}
            />
            {member.personId ? (
              <Link
                href={`/contacts/${member.personId}`}
                className="relative z-10 mt-2 inline-block text-xs font-semibold text-cyan-700"
              >
                Open contact
              </Link>
            ) : null}
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-semibold text-slate-600">
                Edit assignment
              </summary>
              <form action={saveCrewAssignmentAction} className="mt-3 space-y-2">
                <input type="hidden" name="bookingId" value={bookingId} />
                <input type="hidden" name="occurrenceId" value={occurrenceId} />
                <input type="hidden" name="assignmentId" value={member.id} />
                <label className="block text-xs">
                  Known contact
                  <select
                    name="personId"
                    defaultValue={member.personId ?? ""}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  >
                    <option value="">None</option>
                    {editPeople.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs">
                  Role
                  <input
                    name="role"
                    defaultValue={member.role ?? ""}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  />
                </label>
                <label className="block text-xs">
                  Notes
                  <input
                    name="notes"
                    defaultValue={member.notes ?? ""}
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  />
                </label>
                {member.freeformName && !member.personId ? (
                  <input type="hidden" name="freeformName" value={member.freeformName} />
                ) : null}
                <PendingSubmitButton className="font-semibold text-cyan-700">
                  Save crew member
                </PendingSubmitButton>
              </form>
            </details>
            <form action={deleteCrewAssignmentAction} className="mt-2">
              <input type="hidden" name="bookingId" value={bookingId} />
              <input type="hidden" name="occurrenceId" value={occurrenceId} />
              <input type="hidden" name="assignmentId" value={member.id} />
              <PendingSubmitButton
                className="text-xs font-semibold text-red-700"
                pendingLabel="Removing…"
              >
                Remove
              </PendingSubmitButton>
            </form>
          </article>
        ))}
        {!assigned.length ? (
          <p className="text-sm text-slate-500 sm:col-span-2 xl:col-span-3">No crew assigned.</p>
        ) : null}
      </div>

      <div className="space-y-3 border-t border-slate-100 pt-4">
        <h3 className="text-sm font-semibold text-slate-900">Add from contacts</h3>
        <label className="block text-xs text-slate-600">
          Search crew
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name, or type the client organization"
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          />
        </label>
        {query.trim() ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {matches.map((person) => (
              <form key={person.id} action={addCrewAssignmentAction}>
                <input type="hidden" name="bookingId" value={bookingId} />
                <input type="hidden" name="occurrenceId" value={occurrenceId} />
                <input type="hidden" name="personId" value={person.id} />
                <PendingSubmitButton
                  className="w-full rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm hover:border-cyan-600 hover:bg-cyan-50"
                  pendingLabel="Adding…"
                >
                  <ContactTileBody
                    name={person.displayName}
                    email={person.email}
                    phone={person.phone}
                  />
                  <span className="mt-3 inline-block text-xs font-semibold text-cyan-800">
                    Add to crew
                  </span>
                </PendingSubmitButton>
              </form>
            ))}
            {!matches.length ? (
              <p className="text-sm text-slate-500 sm:col-span-2 xl:col-span-3">
                No matching crew for this client.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            Type a name or {clientOrganizationName} to find crew. Results stay
            hidden until you search.
          </p>
        )}

        {addingMember ? (
          <form
            action={createCrewMemberAction}
            className="space-y-3 rounded-xl border border-dashed border-slate-300 p-3"
          >
            <input type="hidden" name="bookingId" value={bookingId} />
            <input type="hidden" name="occurrenceId" value={occurrenceId} />
            <input
              type="hidden"
              name="organizationId"
              value={clientOrganizationId}
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">New crew member</p>
              <button
                type="button"
                onClick={() => setAddingMember(false)}
                className="text-xs font-semibold text-slate-600"
              >
                Cancel
              </button>
            </div>
            <p className="text-xs text-slate-500">
              Saves a contact at {clientOrganizationName} and assigns them to this
              booking.
            </p>
            <label className="block text-sm">
              Name
              <input
                name="displayName"
                required
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="block text-sm">
              Email
              <input
                type="email"
                name="email"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="block text-sm">
              Phone
              <input
                name="phone"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="block text-sm">
              Role
              <input
                name="role"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
            <PendingSubmitButton className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
              Save crew member
            </PendingSubmitButton>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setAddingMember(true)}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            Add crew member
          </button>
        )}
      </div>
    </div>
  );
}
