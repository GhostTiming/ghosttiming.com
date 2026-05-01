import { NextResponse } from "next/server";
import nodemailer from "nodemailer";

const MIN_SUBMISSION_AGE_MS = 2500;
const MAX_SUBMISSION_AGE_MS = 1000 * 60 * 60;
const MAX_FIELD_LENGTH = 2000;

type ContactPayload = {
  name: string;
  email: string;
  phone?: string;
  eventDate?: string;
  eventLocation?: string;
  message: string;
  website?: string;
  formStartedAt?: string;
};

function sanitizeText(value: unknown, maxLength = MAX_FIELD_LENGTH): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPhone(phone: string): boolean {
  return /^[+\d().\-\s]{7,25}$/.test(phone);
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ContactPayload;

    const website = sanitizeText(body.website, 256);
    if (website) {
      return NextResponse.json(
        { ok: false, error: "Submission blocked." },
        { status: 400 },
      );
    }

    const startedAtRaw = sanitizeText(body.formStartedAt, 32);
    const startedAtMs = Number.parseInt(startedAtRaw, 10);
    if (!Number.isFinite(startedAtMs)) {
      return NextResponse.json(
        { ok: false, error: "Form session is invalid. Please retry." },
        { status: 400 },
      );
    }

    const elapsedMs = Date.now() - startedAtMs;
    if (elapsedMs < MIN_SUBMISSION_AGE_MS || elapsedMs > MAX_SUBMISSION_AGE_MS) {
      return NextResponse.json(
        { ok: false, error: "Submission blocked. Please try again." },
        { status: 400 },
      );
    }

    const name = sanitizeText(body.name, 120);
    const email = sanitizeText(body.email, 254).toLowerCase();
    const phone = sanitizeText(body.phone, 40);
    const eventDate = sanitizeText(body.eventDate, 20);
    const eventLocation = sanitizeText(body.eventLocation, 160);
    const message = sanitizeText(body.message, 4000);

    if (!name || !email || !message) {
      return NextResponse.json(
        { ok: false, error: "Name, email, and message are required." },
        { status: 400 },
      );
    }

    if (!isValidEmail(email)) {
      return NextResponse.json(
        { ok: false, error: "Please provide a valid email address." },
        { status: 400 },
      );
    }

    if (phone && !isValidPhone(phone)) {
      return NextResponse.json(
        { ok: false, error: "Please provide a valid phone number." },
        { status: 400 },
      );
    }

    if (eventDate && !isIsoDate(eventDate)) {
      return NextResponse.json(
        { ok: false, error: "Event date must use YYYY-MM-DD format." },
        { status: 400 },
      );
    }

    const toEmail = getRequiredEnv("CONTACT_TO_EMAIL");
    const fromEmail = getRequiredEnv("CONTACT_FROM_EMAIL");
    const smtpHost = getRequiredEnv("SMTP_HOST");
    const smtpPort = Number.parseInt(getRequiredEnv("SMTP_PORT"), 10);
    const smtpUser = getRequiredEnv("SMTP_USER");
    const smtpPass = getRequiredEnv("SMTP_PASS");

    if (!Number.isInteger(smtpPort) || smtpPort <= 0) {
      throw new Error("SMTP_PORT must be a positive integer");
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    const submittedAt = new Date().toISOString();
    const lines = [
      "New Ghost Timing contact form submission",
      "",
      `Name: ${name}`,
      `Email: ${email}`,
      `Phone: ${phone || "Not provided"}`,
      `Event Date: ${eventDate || "Not provided"}`,
      `Event Location: ${eventLocation || "Not provided"}`,
      "",
      "Message:",
      message,
      "",
      `Submitted At (UTC): ${submittedAt}`,
      `Elapsed Before Submit: ${elapsedMs}ms`,
    ];

    await transporter.sendMail({
      to: toEmail,
      from: fromEmail,
      replyTo: email,
      subject: "New Ghost Timing Contact Form Submission",
      text: lines.join("\n"),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Contact form submission failed", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          "We could not send your request right now. Please try again shortly.",
      },
      { status: 500 },
    );
  }
}
