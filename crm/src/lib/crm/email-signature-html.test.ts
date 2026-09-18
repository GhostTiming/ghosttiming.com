import { describe, expect, it } from "vitest";
import {
  appendEmailSignature,
  DEFAULT_EMAIL_SIGNATURE_HTML,
  plainTextToHtml,
  sanitizeSignatureHtml,
  signatureImageTag,
} from "./email-signature-html";

describe("email signatures", () => {
  it("keeps hosted images and links in pasted HTML", () => {
    const html = sanitizeSignatureHtml(`
      <a href="https://ghosttiming.com">
        <img src="https://cdn.example.com/logo.jpg" alt="Ghost Timing" />
      </a>
      <p>Call <a href="tel:+14075551212">407-555-1212</a></p>
    `);
    expect(html).toContain('href="https://ghosttiming.com"');
    expect(html).toContain('src="https://cdn.example.com/logo.jpg"');
    expect(html).toContain('href="tel:+14075551212"');
  });

  it("strips scripts and javascript URLs", () => {
    const html = sanitizeSignatureHtml(
      `<p onclick="alert(1)">Hi</p><a href="javascript:alert(1)">x</a><script>alert(1)</script><img src="https://cdn.example.com/a.png">`,
    );
    expect(html).not.toContain("script");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('src="https://cdn.example.com/a.png"');
  });

  it("appends a signature as HTML so images still work", () => {
    const composed = appendEmailSignature({
      bodyText: "See you Saturday.",
      signatureHtml: DEFAULT_EMAIL_SIGNATURE_HTML,
    });
    expect(composed.html).toContain("See you Saturday.");
    expect(composed.html).toContain("<img");
    expect(composed.html).toContain("ghosttiming.com");
    expect(composed.text).toContain("See you Saturday.");
    expect(composed.text).toContain("Ghost Timing");
  });

  it("wraps plain text as HTML before attaching a signature", () => {
    expect(plainTextToHtml("Line 1\nLine 2")).toContain("Line 1<br />Line 2");
  });

  it("builds an image tag from a hosted URL", () => {
    expect(signatureImageTag("https://cdn.example.com/sig.png")).toContain(
      'src="https://cdn.example.com/sig.png"',
    );
    expect(() => signatureImageTag("ftp://cdn.example.com/sig.png")).toThrow(
      /http or https/i,
    );
  });
});
