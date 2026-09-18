// Sends one plain test email using the same provider rules as the app.
// Usage:  node --env-file=.env.local scripts/send-test-email.mjs you@example.com
import nodemailer from "nodemailer";
import { Resend } from "resend";

const to = process.argv[2];
if (!to) {
  console.error("Usage: node --env-file=.env.local scripts/send-test-email.mjs recipient@example.com");
  process.exit(1);
}
const from = process.env.EMAIL_FROM ?? "Tickets <onboarding@resend.dev>";
const subject = `Drift Tickets SMTP/Resend test ${new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" })}`;
const html = `<p>This is a test message from the Drift Tickets system.</p><p>If you can read this, outbound email is configured correctly.</p>`;

try {
  if (process.env.SMTP_HOST) {
    const port = Number(process.env.SMTP_PORT ?? 587);
    const t = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: process.env.SMTP_SECURE === "true" || port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      logger: false,
    });
    await t.verify();
    console.log(`SMTP login OK on ${process.env.SMTP_HOST}:${port} as ${process.env.SMTP_USER}`);
    const info = await t.sendMail({ from, to, subject, html });
    console.log("Sent via SMTP:", info.messageId, info.response);
  } else if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { data, error } = await resend.emails.send({ from, to, subject, html });
    if (error) throw new Error(error.message);
    console.log("Sent via Resend:", data?.id);
  } else {
    console.log("No SMTP_HOST or RESEND_API_KEY set. Nothing sent (dry-run).");
  }
} catch (e) {
  console.error("Email test FAILED:", e.message ?? e);
  process.exit(1);
}
