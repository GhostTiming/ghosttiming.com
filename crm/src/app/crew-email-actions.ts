"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getPool } from "@/db";
import { requireBookingOperator } from "@/lib/auth/server";
import { normalizeEmail } from "@/lib/contact-extraction/extract";
import {
  crewEmailTimerFromUser,
  renderCrewEmailTemplate,
  type CrewEmailBooking,
  type CrewEmailRace,
} from "@/lib/crm/crew-email";
import { parseRecipientField } from "@/lib/crm/email-compose";
import { htmlToPlainText } from "@/lib/crm/email-placeholders";
import { getUserEmailTemplate } from "@/lib/crm/email-templates";
import { uniqueNormalizedEmails } from "@/lib/google/email-match";

const uuid = z.string().uuid();

function refreshBooking(bookingId: string) {
  revalidatePath(`/bookings/${bookingId}`, "layout");
  revalidatePath("/bookings", "layout");
}

type CrewEmailBookingRow = {
  event_name: string;
  registration_url: string | null;
  timer_online_at: string | null;
  timer_location: string | null;
  organization_name: string | null;
  hardware_event_name: string | null;
  scoring_expectations: string | null;
  post_event_expectations: string | null;
  operations_notes: string | null;
  source_prospect_id: string | null;
};

async function loadCrewEmailContext(bookingId: string, userId: string) {
  const pool = getPool();
  const [booking, races, points, crew, timer] = await Promise.all([
    pool.query<CrewEmailBookingRow>(
      `
        SELECT
          event.name AS event_name,
          COALESCE(
            occurrence.registration_url_override,
            event.website,
            listing.registration_url,
            listing.external_race_url,
            source_listing.registration_url,
            source_listing.external_race_url
          ) AS registration_url,
          COALESCE(occurrence.arrival_override_at, occurrence.calculated_arrival_at)::text AS timer_online_at,
          occurrence.timer_location::text AS timer_location,
          org.name AS organization_name,
          occurrence.hardware_event_name,
          occurrence.scoring_expectations,
          occurrence.post_event_expectations,
          occurrence.notes AS operations_notes,
          prospect.id::text AS source_prospect_id
        FROM crm.bookings booking
        JOIN crm.event_occurrences occurrence ON occurrence.id = booking.occurrence_id
        JOIN crm.events event ON event.id = occurrence.event_id
        JOIN crm.organizations org ON org.id = booking.direct_client_organization_id
        LEFT JOIN catalog.race_listings listing
          ON listing.id = event.catalog_race_listing_id
        LEFT JOIN crm.prospects prospect ON prospect.converted_booking_id = booking.id
        LEFT JOIN catalog.race_listings source_listing
          ON source_listing.id = prospect.race_listing_id
        WHERE booking.id = $1::uuid
      `,
      [bookingId],
    ),
    pool.query<{
      name: string;
      distance_label: string | null;
      start_time: string | null;
      age_groups: string | null;
      awards: string | null;
      scoring: unknown;
    }>(
      `
        SELECT race.name, race.distance_label, race.start_time::text,
               race.age_groups, race.awards, race.scoring
        FROM crm.occurrence_races race
        JOIN crm.bookings booking ON booking.occurrence_id = race.occurrence_id
        WHERE booking.id = $1::uuid
        ORDER BY race.sort_order, race.start_time
      `,
      [bookingId],
    ),
    pool.query<{
      name: string;
      hardware_point_name: string | null;
      notes: string | null;
    }>(
      `
        SELECT point.name, point.hardware_point_name, point.notes
        FROM crm.course_points point
        JOIN crm.bookings booking ON booking.occurrence_id = point.occurrence_id
        WHERE booking.id = $1::uuid
        ORDER BY point.sort_order
      `,
      [bookingId],
    ),
    pool.query<{ person_id: string | null; email: string | null }>(
      `
        SELECT assignment.person_id::text, person.email
        FROM crm.crew_assignments assignment
        LEFT JOIN crm.people person ON person.id = assignment.person_id
        JOIN crm.bookings booking ON booking.occurrence_id = assignment.occurrence_id
        WHERE booking.id = $1::uuid
      `,
      [bookingId],
    ),
    pool.query<{
      first_name: string | null;
      last_name: string | null;
      name: string;
      phone: string | null;
      email: string;
      send_email: string | null;
    }>(
      `
        SELECT
          users.first_name,
          users.last_name,
          users.name,
          users.phone,
          users.email,
          send.google_email AS send_email
        FROM crm.users users
        LEFT JOIN crm.google_connections send
          ON send.user_id = users.id
         AND send.google_sub = users.default_send_google_sub
        WHERE users.id = $1::uuid
      `,
      [userId],
    ),
  ]);
  const row = booking.rows[0];
  if (!row) throw new Error("Booking not found.");
  const timerRow = timer.rows[0];
  const crewEmails = uniqueNormalizedEmails(crew.rows.map((member) => member.email));
  const emailSet = new Set(crewEmails);
  const personIds = [
    ...new Set(
      crew.rows.flatMap((member) => {
        if (!member.person_id || !member.email) return [];
        return emailSet.has(normalizeEmail(member.email)) ? [member.person_id] : [];
      }),
    ),
  ];
  const crewBooking: CrewEmailBooking = {
    eventName: row.event_name,
    registrationUrl: row.registration_url,
    timerOnlineAt: row.timer_online_at,
    timerLocation: row.timer_location,
    organizationName: row.organization_name,
    hardwareEventName: row.hardware_event_name,
    scoringExpectations: row.scoring_expectations,
    postEventExpectations: row.post_event_expectations,
    operationsNotes: row.operations_notes,
    races: races.rows.map(
      (race): CrewEmailRace => ({
        name: race.name,
        distanceLabel: race.distance_label,
        startTime: race.start_time,
        ageGroups: race.age_groups,
        awards: race.awards,
        scoring: race.scoring,
        legacyAgeGroups: race.age_groups,
        legacyAwards: race.awards,
      }),
    ),
    coursePoints: points.rows.map((point) => ({
      name: point.name,
      hardwarePointName: point.hardware_point_name,
      notes: point.notes,
    })),
  };
  return {
    booking: crewBooking,
    sourceProspectId: row.source_prospect_id,
    crewEmails,
    personIds,
    timer: crewEmailTimerFromUser({
      firstName: timerRow?.first_name,
      lastName: timerRow?.last_name,
      name: timerRow?.name,
      phone: timerRow?.phone,
      email: timerRow?.send_email || timerRow?.email,
    }),
  };
}

export async function renderCrewEmailAction(input: { bookingId: string; templateId: string }) {
  const bookingId = uuid.parse(input.bookingId);
  const templateId = uuid.parse(input.templateId);
  const { user } = await requireBookingOperator(bookingId);
  const [template, context] = await Promise.all([
    getUserEmailTemplate(user.id, templateId),
    loadCrewEmailContext(bookingId, user.id),
  ]);
  if (!template) throw new Error("Choose an email template.");
  const rendered = renderCrewEmailTemplate(
    { subject: template.subject, bodyHtml: template.body_html },
    context.booking,
    context.timer,
  );
  return {
    templateId: template.id,
    templateName: template.name,
    subject: rendered.subject,
    html: rendered.html,
    to: context.crewEmails.join(", "),
    personIds: context.personIds,
    prospectId: context.sourceProspectId,
  };
}

export async function recordCrewEmailSentAction(input: {
  bookingId: string;
  subject: string;
  to: string;
  html: string;
  gmailMessageId: string;
}) {
  const bookingId = uuid.parse(input.bookingId);
  const { user } = await requireBookingOperator(bookingId);
  const toAddresses = parseRecipientField(input.to);
  if (!toAddresses.length) {
    throw new Error("Add at least one crew recipient before sending.");
  }
  const subject = z.string().trim().max(500).parse(input.subject);
  const html = z.string().min(1).max(200_000).parse(input.html);
  const gmailMessageId = z.string().trim().min(1).max(200).parse(input.gmailMessageId);
  const snippet = htmlToPlainText(html).slice(0, 400);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `
        UPDATE crm.booking_prep_items
        SET status = 'complete',
            updated_by_user_id = $2::uuid,
            updated_at = now()
        WHERE booking_id = $1::uuid AND key = 'crew_email_sent'
      `,
      [bookingId, user.id],
    );
    const existing = await client.query<{ id: string }>(
      `
        SELECT id::text
        FROM crm.activities
        WHERE booking_id = $1::uuid
          AND metadata->>'gmailMessageId' = $2
        LIMIT 1
      `,
      [bookingId, gmailMessageId],
    );
    if (!existing.rows[0]) {
      await client.query(
        `
          INSERT INTO crm.activities (
            booking_id, type, occurred_at, body,
            actor_type, actor_user_id, actor_name, metadata
          )
          VALUES (
            $1::uuid, 'email', now(), $2,
            'human', $3::uuid, $4, $5::jsonb
          )
        `,
        [
          bookingId,
          `Crew email sent: ${subject || "(no subject)"}`,
          user.id,
          user.name,
          JSON.stringify({
            source: "gmail",
            kind: "crew_email",
            gmailMessageId,
            toAddresses,
            snippet,
          }),
        ],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  refreshBooking(bookingId);
}
