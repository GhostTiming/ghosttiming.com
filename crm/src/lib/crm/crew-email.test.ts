import { describe, expect, it } from "vitest";
import {
  CREW_EMAIL_LOGO_URL,
  DEFAULT_CREW_EMAIL_HTML,
  buildCrewEmailValues,
  formatCrewAdditionalExpectations,
  formatCrewAwardsAndAgeGroups,
  formatCrewCoursePoints,
  formatCrewDistances,
  formatCrewEventNameToProgram,
  formatCrewNotesLabel,
  formatTimerPhone,
  renderCrewEmailTemplate,
  timerPhoneHref,
} from "./crew-email";
import { applyEmailTemplate, htmlToPlainText } from "./email-placeholders";

describe("crew email placeholders", () => {
  it("maps CRM tokens and Bigin Event Pipeline fields", () => {
    const html = applyEmailTemplate(
      "{{event_name}} / ${Event Pipeline.Event Name} / ${Event Pipeline.Arr. Time}",
      {
        event_name: "Holiday 3k",
        timer_online_at: "6:00 AM",
      },
    );
    expect(html).toBe("Holiday 3k / Holiday 3k / 6:00 AM");
  });

  it("escapes interpolated text and keeps explicit HTML values", () => {
    const html = applyEmailTemplate(
      "<p>{{event_name}}</p>{{registration_link}}",
      {
        event_name: '5K <script>alert("x")</script>',
        registration_link: {
          html: '<a href="https://example.com">https://example.com</a>',
        },
      },
    );
    expect(html).toContain("5K &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).toContain('<a href="https://example.com">https://example.com</a>');
  });
});

describe("crew email field formatters", () => {
  it("formats races, course points, hardware names, and scoring", () => {
    expect(formatCrewDistances([{ name: "5K", startTime: "2026-12-22 08:00:00" }])).toBe(
      "5K @ 8:00AM Start",
    );
    expect(
      formatCrewCoursePoints([
        { name: "Start/Finish", hardwarePointName: "MAIN", notes: "Parking lot" },
      ]),
    ).toBe("Start/Finish • Point name: MAIN");
    expect(formatCrewEventNameToProgram("HOLIDAY3K")).toBe("HOLIDAY3K");
    expect(
      formatCrewEventNameToProgram(null),
    ).toBe("");
    expect(formatCrewAdditionalExpectations({})).toBe("");
    expect(
      formatCrewAwardsAndAgeGroups([
        {
          name: "5K",
          startTime: "08:00",
          scoring: {
            ageGroups: [{ genders: ["female"], minAge: 0, maxAge: 19, awardDepth: 3 }],
            awards: [{ title: "Overall", genders: ["female"], minAge: null, maxAge: null }],
            notes: null,
          },
        },
      ]),
    ).toMatch(/5K @ 8:00AM Start\n\nAwards:\nOverall · F\n\nAge groups:\nF · 19 and under · Top 3/);
    expect(
      formatCrewAwardsAndAgeGroups([
        {
          name: "5K",
          startTime: "08:00",
          scoring: {
            ageGroups: [{ genders: ["male", "female"], minAge: 0, maxAge: 12, awardDepth: 3 }],
            awards: [],
            notes: null,
          },
        },
      ]),
    ).toMatch(/5K @ 8:00AM Start\n\nAwards:\nTop 3\n\nAge groups:\nF\/M · 12 and under · Top 3/);
    expect(formatCrewNotesLabel("remote")).toBe("Remote crew notes");
    expect(formatTimerPhone("4076872570")).toBe("(407) 687-2570");
    expect(timerPhoneHref("4076872570")).toBe("+14076872570");
  });

  it("renders the default remote crew notes template from booking data", () => {
    const rendered = renderCrewEmailTemplate(
      { subject: "{{event_name}} — race-day crew notes", bodyHtml: DEFAULT_CREW_EMAIL_HTML },
      {
        eventName: "Holiday 3k",
        registrationUrl: "https://runsignup.com/holiday3k",
        timerOnlineAt: "2026-12-22T11:00:00.000Z",
        timerLocation: "remote",
        organizationName: "Brevard Zoo",
        hardwareEventName: "HOLIDAY3K",
        scoringExpectations: "Live results",
        races: [{ name: "3K", distanceLabel: "3K", startTime: "2026-12-22 08:00:00" }],
        coursePoints: [{ name: "Finish", hardwarePointName: "FINISH" }],
      },
      {
        name: "Michelle Splitstone-Laloggia",
        phone: "4076872570",
        email: "michelle@run4acause.org",
      },
    );
    expect(rendered.subject).toBe("Holiday 3k — race-day crew notes");
    expect(rendered.html).toContain("Holiday 3k");
    expect(rendered.html).toContain("https://runsignup.com/holiday3k");
    expect(rendered.html).toContain("tel:+14076872570");
    expect(rendered.html).toContain("michelle@run4acause.org");
    expect(rendered.html).toContain("Brevard Zoo");
    expect(rendered.html).toContain("Remote crew notes");
    expect(rendered.html).toContain(CREW_EMAIL_LOGO_URL);
    expect(DEFAULT_CREW_EMAIL_HTML).toContain(CREW_EMAIL_LOGO_URL);
    expect(DEFAULT_CREW_EMAIL_HTML).toContain("Ghost Timing");
    expect(DEFAULT_CREW_EMAIL_HTML).toContain("Event Name to Program");
    expect(DEFAULT_CREW_EMAIL_HTML).toContain(
      "Start / Split / Finish Locations and Point Name to Program",
    );
    expect(DEFAULT_CREW_EMAIL_HTML).not.toContain("Event and Point Name to Program");
    expect(rendered.html).toContain("HOLIDAY3K");
    expect(rendered.html).toContain("Finish • Point name: FINISH");
    expect(rendered.html).toContain("Live results");
    expect(rendered.html).not.toContain("Not set");
    expect(rendered.html).not.toContain("bigin.zoho.com");
    expect(rendered.html).not.toContain("${Event Pipeline");
    expect(htmlToPlainText(rendered.html)).toContain("3K @ 8:00AM Start");
  });

  it("fills a pasted Bigin template with CRM values", () => {
    const values = buildCrewEmailValues(
      {
        eventName: "Holiday 3k",
        registrationUrl: "https://example.com",
        hardwareEventName: "HOLIDAY3K",
        races: [],
        coursePoints: [{ name: "Start", hardwarePointName: "START" }],
      },
      { name: "Michelle", phone: "4076872570", email: "michelle@run4acause.org" },
    );
    const html = applyEmailTemplate(
      "${Event Pipeline.Event Name} ${Event Pipeline.Race Registration Site} ${Event Pipeline.Event & Point Name}",
      values,
    );
    expect(html).toContain("Holiday 3k");
    expect(html).toContain("https://example.com");
    expect(html).toContain("HOLIDAY3K");
  });

  it("leaves additional expectations blank when nothing is entered", () => {
    const booking = {
      eventName: "Miles to Go 5K",
      hardwareEventName: "MTG5K",
      races: [{ name: "5K", startTime: "2026-09-19 08:00:00" }],
      coursePoints: [{ name: "Start/Finish", hardwarePointName: "MAIN" }],
    };
    const timer = { name: "Michelle" };
    const values = buildCrewEmailValues(booking, timer);
    const rendered = renderCrewEmailTemplate(
      { subject: "{{event_name}}", bodyHtml: DEFAULT_CREW_EMAIL_HTML },
      booking,
      timer,
    );
    expect(values.event_name_to_program).toBe("MTG5K");
    expect(values.course_points).toBe("Start/Finish • Point name: MAIN");
    expect(values.additional_expectations).toBe("");
    expect(htmlToPlainText(rendered.html)).toContain("MTG5K");
    expect(htmlToPlainText(rendered.html)).toContain("Start/Finish • Point name: MAIN");
    expect(htmlToPlainText(rendered.html)).not.toMatch(/Additional Expectations\s+Not set/i);
  });
});
