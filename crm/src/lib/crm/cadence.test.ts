import { describe, expect, it } from "vitest";
import {
  addOffsetDays,
  cadenceSendableContactStatusSql,
  cadenceStepLabel,
  greetingLine,
  isAutomaticReply,
  normalizeUsState,
  timingModeLine,
} from "./cadence-copy";
import { renderCadenceTemplate } from "./cadence-copy";

describe("cadence merge fields", () => {
  it("greets by first name or falls back", () => {
    expect(greetingLine("Michelle")).toBe("Hi Michelle,");
    expect(greetingLine("  ")).toBe("Hey there,");
    expect(greetingLine(null)).toBe("Hey there,");
  });

  it("picks timing language from state", () => {
    expect(timingModeLine("FL")).toBe("on-site or remote timing");
    expect(timingModeLine("Florida")).toBe("on-site or remote timing");
    expect(timingModeLine("GA")).toBe("remote or on-site timing");
    expect(timingModeLine("tn")).toBe("remote or on-site timing");
    expect(timingModeLine("NY")).toBe("remote timing");
    expect(timingModeLine(null)).toBe("remote timing");
    expect(normalizeUsState("south carolina")).toBe("SC");
  });

  it("renders subject and body with the same tokens", () => {
    const rendered = renderCadenceTemplate({
      subject: "{{event_name}}, timing & event support",
      bodyHtml: "<p>{{greeting_line}}</p><p>We work on {{timing_mode_line}} for {{event_name}}.</p>",
      greetingLine: "Hi Jane,",
      eventName: "Fiddlin' 5K",
      timingModeLine: "remote timing",
    });
    expect(rendered.subject).toBe("Fiddlin' 5K, timing & event support");
    expect(rendered.bodyHtml).toContain("Hi Jane,");
    expect(rendered.bodyHtml).toContain("remote timing");
    expect(rendered.bodyHtml).toContain("Fiddlin&#39; 5K");
    expect(rendered.bodyText).toMatch(/Hi Jane,/);
  });

  it("appends a signature at render time", () => {
    const rendered = renderCadenceTemplate({
      subject: "Hi",
      bodyHtml: "<p>Body</p>",
      greetingLine: "Hey there,",
      eventName: "Race",
      timingModeLine: "remote timing",
      signatureHtml: "<p>Ghost Timing</p>",
    });
    expect(rendered.bodyHtml).toContain("Ghost Timing");
    expect(rendered.bodyText).toContain("Ghost Timing");
  });
});

describe("cadence reply filter", () => {
  it("ignores automatic replies and bounce mail", () => {
    expect(
      isAutomaticReply({ subject: "Automatic reply: Out of office" }),
    ).toBe(true);
    expect(isAutomaticReply({ subject: "Out of Office" })).toBe(true);
    expect(
      isAutomaticReply({ subject: "Delivery Status Notification (Failure)" }),
    ).toBe(true);
    expect(
      isAutomaticReply({ fromAddress: "mailer-daemon@google.com" }),
    ).toBe(true);
    expect(
      isAutomaticReply({
        subject: "Re: timing",
        fromAddress: "rd@example.org",
        bodyText: "We already have a timer.",
      }),
    ).toBe(false);
  });
});

describe("cadence contact status SQL", () => {
  it("only compares enum values that exist on contact_method_status", () => {
    const sql = cadenceSendableContactStatusSql("method");
    expect(sql).toBe("method.status IN ('valid', 'unknown')");
    expect(sql).not.toContain("opted_out");
  });
});

describe("cadence scheduling helpers", () => {
  it("labels touches and offsets from enrollment, not the previous send", () => {
    expect(cadenceStepLabel(2, 4)).toBe("Touch 2 of 4");
    const enrolled = new Date("2026-09-18T16:00:00.000Z");
    expect(addOffsetDays(enrolled, 0).toISOString()).toBe("2026-09-18T16:00:00.000Z");
    expect(addOffsetDays(enrolled, 5).toISOString()).toBe("2026-09-23T16:00:00.000Z");
    expect(addOffsetDays(enrolled, 10).toISOString()).toBe("2026-09-28T16:00:00.000Z");
    expect(addOffsetDays(enrolled, 24).toISOString()).toBe("2026-10-12T16:00:00.000Z");
  });
});
