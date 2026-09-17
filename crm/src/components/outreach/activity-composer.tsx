"use client";

import { CalendarPlus, Loader2, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { logOutreachActivityAction } from "@/app/outreach-actions";
import { EventTypeSelect } from "@/components/event-type-select";
import { GoogleConnectionControl } from "@/components/google/google-connection-control";
import { useGoogleSession } from "@/components/google/google-session-provider";
import {
  FormSaveFailedContext,
  PendingSubmitButton,
} from "@/components/pending-submit-button";
import { dispositions, type TimelineEventType } from "@/lib/crm/domain";
import {
  DEFAULT_MEETING_DURATION_MINUTES,
  defaultMeetingSubject,
  parseMeetingAttendees,
  parseMeetingDurationMinutes,
  parseMeetingStart,
  type OutreachRecordKind,
} from "@/lib/crm/outreach-activity";
import { uniqueNormalizedEmails } from "@/lib/google/email-match";
import { buildOutreachCalendarEvent } from "@/lib/google/calendar-meeting";

export type OutreachContactOption = {
  email: string;
  label?: string | null;
  defaultSelected?: boolean;
};

export type OutreachPersonOption = {
  id: string;
  name: string;
  email: string | null;
};

export function ActivityComposer({
  recordKind,
  recordId,
  recordTitle,
  contacts,
  people,
}: {
  recordKind: OutreachRecordKind;
  recordId: string;
  recordTitle: string;
  contacts: OutreachContactOption[];
  people: OutreachPersonOption[];
}) {
  const router = useRouter();
  const google = useGoogleSession();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const extraEmailRef = useRef<HTMLInputElement>(null);
  const [eventType, setEventType] = useState<TimelineEventType | "">("");
  const [subject, setSubject] = useState(defaultMeetingSubject(recordTitle));
  const [startsAt, setStartsAt] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(
    String(DEFAULT_MEETING_DURATION_MINUTES),
  );
  const [includeGoogleMeet, setIncludeGoogleMeet] = useState(true);
  const [extraEmails, setExtraEmails] = useState<string[]>([]);
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(() => {
    const initial = contacts
      .filter((contact) => contact.defaultSelected !== false)
      .map((contact) => contact.email);
    return new Set(uniqueNormalizedEmails(initial));
  });
  const [personQuery, setPersonQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);

  const meetingMode = eventType === "meeting";
  const connected = Boolean(google.connection && google.accessToken && !google.expired);
  const peopleWithEmail = useMemo(
    () =>
      people.filter((person) => person.email?.includes("@")),
    [people],
  );
  const filteredPeople = useMemo(() => {
    const query = personQuery.trim().toLowerCase();
    if (query.length < 2) return [];
    return peopleWithEmail
      .filter((person) =>
        `${person.name} ${person.email}`.toLowerCase().includes(query),
      )
      .slice(0, 12);
  }, [peopleWithEmail, personQuery]);

  function openMeeting() {
    setEventType("meeting");
    if (detailsRef.current) detailsRef.current.open = true;
  }

  function toggleEmail(email: string, checked: boolean) {
    setSelectedEmails((current) => {
      const next = new Set(current);
      if (checked) next.add(email);
      else next.delete(email);
      return next;
    });
  }

  function addExtraEmails(raw: string) {
    const added = parseMeetingAttendees(raw.split(/[\s,;]+/));
    if (!added.length) return;
    setExtraEmails((current) => uniqueNormalizedEmails(current, added));
    setSelectedEmails((current) => new Set(uniqueNormalizedEmails([...current], added)));
    if (extraEmailRef.current) extraEmailRef.current.value = "";
  }

  function removeExtraEmail(email: string) {
    setExtraEmails((current) => current.filter((item) => item !== email));
    toggleEmail(email, false);
  }

  async function submit(formData: FormData) {
    setError(null);
    setSaveFailed(false);
    if (eventType !== "meeting") {
      setBusy(true);
      try {
        await logOutreachActivityAction(formData);
        router.refresh();
        if (detailsRef.current) detailsRef.current.open = false;
      } catch (cause) {
        setSaveFailed(true);
        setError(cause instanceof Error ? cause.message : "Could not save activity.");
      } finally {
        setBusy(false);
      }
      return;
    }

    setBusy(true);
    try {
      if (!connected) throw new Error("Connect Google to send the calendar invite.");
      const start = parseMeetingStart(startsAt);
      const minutes = parseMeetingDurationMinutes(durationMinutes);
      const attendees = parseMeetingAttendees([...selectedEmails]);
      const created = await google.createOutreachCalendarEvent(
        buildOutreachCalendarEvent({
          recordKind,
          recordId,
          subject: subject.trim() || defaultMeetingSubject(recordTitle),
          startsAt: start,
          durationMinutes: minutes,
          attendees,
          agenda: String(formData.get("body") ?? ""),
          includeGoogleMeet,
          requestId: crypto.randomUUID(),
        }),
      );
      formData.set("meetingSubject", subject.trim() || defaultMeetingSubject(recordTitle));
      formData.set("meetingStartsAt", start.toISOString());
      formData.set("meetingDurationMinutes", String(minutes));
      formData.set("meetingAttendees", attendees.join(","));
      formData.set("includeGoogleMeet", includeGoogleMeet ? "true" : "false");
      formData.set("googleEventId", created.id);
      formData.set("googleCalendarId", created.calendarId);
      if (created.htmlLink) formData.set("htmlLink", created.htmlLink);
      if (created.hangoutLink) formData.set("hangoutLink", created.hangoutLink);
      await logOutreachActivityAction(formData);
      router.refresh();
      if (detailsRef.current) detailsRef.current.open = false;
    } catch (cause) {
      setSaveFailed(true);
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not send the calendar invite.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Log an activity</h2>
        <button
          type="button"
          onClick={openMeeting}
          className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-sm font-semibold text-cyan-800 hover:bg-cyan-100"
        >
          <CalendarPlus aria-hidden className="size-4" />
          Schedule meeting
        </button>
      </div>
      <details ref={detailsRef} className="mt-3">
        <summary className="cursor-pointer text-sm font-semibold text-slate-600">
          {meetingMode ? "New event" : "Task, call, email, or note"}
        </summary>
        <form action={submit} className="mt-4 grid gap-4">
          <input
            type="hidden"
            name={recordKind === "prospect" ? "prospectId" : "bookingId"}
            value={recordId}
          />
          <div className={`grid gap-4 ${meetingMode ? "" : "sm:grid-cols-2"}`}>
            <label className="grid gap-1 text-sm font-medium">
              Event type
              <EventTypeSelect
                value={eventType}
                onChange={(event) =>
                  setEventType(event.target.value as TimelineEventType | "")
                }
                className="rounded-lg border border-slate-300 bg-white px-3 py-2"
              />
            </label>
            {meetingMode ? null : (
              <label className="grid gap-1 text-sm font-medium">
                Disposition
                <select
                  name="disposition"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2"
                >
                  <option value="">None</option>
                  {dispositions.map((disposition) => (
                    <option key={disposition}>{disposition}</option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {meetingMode ? (
            <div className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm text-slate-600">
                Salesforce-style event: pick a start time, duration, and attendees.
                We’ll send a Google Calendar invite, then log it on this record.
              </p>
              <label className="grid gap-1 text-sm font-medium">
                Subject
                <input
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2"
                />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-1 text-sm font-medium">
                  Start
                  <input
                    required
                    type="datetime-local"
                    value={startsAt}
                    onChange={(event) => setStartsAt(event.target.value)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2"
                  />
                </label>
                <label className="grid gap-1 text-sm font-medium">
                  Duration (minutes)
                  <input
                    required
                    type="number"
                    min={1}
                    max={1440}
                    value={durationMinutes}
                    onChange={(event) => setDurationMinutes(event.target.value)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2"
                  />
                </label>
              </div>
              <fieldset className="grid gap-2">
                <legend className="text-sm font-semibold">Participants</legend>
                {contacts.length ? (
                  <ul className="grid gap-1">
                    {contacts.map((contact) => {
                      const email = uniqueNormalizedEmails(contact.email)[0];
                      if (!email) return null;
                      return (
                        <li key={email}>
                          <label className="flex items-start gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={selectedEmails.has(email)}
                              onChange={(event) =>
                                toggleEmail(email, event.target.checked)
                              }
                              className="mt-1"
                            />
                            <span>
                              <span className="font-medium">{email}</span>
                              {contact.label ? (
                                <span className="block text-xs text-slate-500">
                                  {contact.label}
                                </span>
                              ) : null}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-500">No record emails yet. Add attendees below.</p>
                )}
                <label className="grid gap-1 text-sm font-medium">
                  Add people from CRM
                  <input
                    value={personQuery}
                    onChange={(event) => setPersonQuery(event.target.value)}
                    placeholder="Search name or email"
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2"
                  />
                </label>
                {filteredPeople.length ? (
                  <ul className="max-h-40 overflow-auto rounded-lg border border-slate-200 bg-white p-2">
                    {filteredPeople.map((person) => {
                      const email = uniqueNormalizedEmails(person.email)[0];
                      if (!email) return null;
                      return (
                        <li key={person.id}>
                          <label className="flex items-start gap-2 rounded-md px-2 py-1 text-sm hover:bg-slate-50">
                            <input
                              type="checkbox"
                              checked={selectedEmails.has(email)}
                              onChange={(event) =>
                                toggleEmail(email, event.target.checked)
                              }
                              className="mt-1"
                            />
                            <span>
                              <span className="font-medium">{person.name}</span>
                              <span className="block text-xs text-slate-500">{email}</span>
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-xs text-slate-500">
                    {personQuery.trim().length < 2
                      ? "Type at least two characters to find CRM people."
                      : "No matching people with email addresses."}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {extraEmails.map((email) => (
                    <span
                      key={email}
                      className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-xs font-medium ring-1 ring-slate-200"
                    >
                      {email}
                      <button
                        type="button"
                        onClick={() => removeExtraEmail(email)}
                        className="text-slate-500 hover:text-slate-900"
                        aria-label={`Remove ${email}`}
                      >
                        <X className="size-3.5" />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    ref={extraEmailRef}
                    type="email"
                    placeholder="Add another email"
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addExtraEmails(event.currentTarget.value);
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => addExtraEmails(extraEmailRef.current?.value ?? "")}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
                  >
                    <Plus className="size-4" />
                    Add
                  </button>
                </div>
              </fieldset>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={includeGoogleMeet}
                  onChange={(event) => setIncludeGoogleMeet(event.target.checked)}
                />
                Include Google Meet in calendar invite
              </label>
              {connected ? null : (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-sm text-amber-900">
                    Connect Google to send the invite from your calendar.
                  </p>
                  <div className="mt-2">
                    <GoogleConnectionControl variant="inline" />
                  </div>
                </div>
              )}
            </div>
          ) : null}

          <label className="grid gap-1 text-sm font-medium">
            {meetingMode ? "Agenda / description" : "Description"}
            <textarea
              name="body"
              required={!meetingMode}
              rows={4}
              placeholder={meetingMode ? "Optional agenda for the invite" : "What happened?"}
              className="rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          <fieldset className="grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2">
            <legend className="px-1 text-sm font-semibold">Optional follow-up task</legend>
            <label className="grid gap-1 text-sm font-medium">
              Next action
              <input
                name="followUpTitle"
                placeholder="Email Sarah"
                className="rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Due
              <input
                name="followUpDueAt"
                type="datetime-local"
                className="rounded-lg border border-slate-300 px-3 py-2"
              />
            </label>
          </fieldset>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          <FormSaveFailedContext.Provider value={saveFailed}>
            <PendingSubmitButton
              disabled={busy || (meetingMode && !connected)}
              pendingLabel={meetingMode ? "Sending invite…" : "Saving…"}
              className="inline-flex justify-self-start rounded-lg bg-cyan-600 px-5 py-2.5 font-semibold text-white hover:bg-cyan-700 disabled:opacity-60"
            >
              {busy ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 aria-hidden className="size-4 animate-spin" />
                  {meetingMode ? "Sending invite…" : "Saving…"}
                </span>
              ) : meetingMode ? (
                "Send invite and log"
              ) : (
                "Save activity"
              )}
            </PendingSubmitButton>
          </FormSaveFailedContext.Provider>
        </form>
      </details>
    </section>
  );
}
