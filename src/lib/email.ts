import { Resend } from "resend";
import nodemailer, { type Transporter } from "nodemailer";
import { SITE_URL } from "@/config/event";
import { php } from "@/lib/money";
import { getEmailSettings, type EmailSettings } from "@/lib/settings";
import type { OrderBundle } from "@/lib/queries";

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  attachments?: { filename: string; content: Buffer }[];
}

/**
 * Provider selection (see lib/settings.ts): settings saved in Admin > Settings win,
 * then environment variables. SMTP if a host is set, else Resend if an API key is
 * set, else dry run (log to the server console and send nothing).
 */

// One pooled SMTP transport per distinct configuration, so a settings change
// from the admin page takes effect on the next email without a restart.
let smtpCache: { key: string; transport: Transporter } | null = null;
function smtp(s: EmailSettings): Transporter {
  const key = [s.smtp_host, s.smtp_port, s.smtp_user, s.smtp_pass, s.smtp_secure].join("|");
  if (smtpCache?.key === key) return smtpCache.transport;
  smtpCache?.transport.close();
  const transport = nodemailer.createTransport({
    host: s.smtp_host,
    port: s.smtp_port,
    secure: s.smtp_secure || s.smtp_port === 465, // STARTTLS is negotiated automatically on 587
    auth: s.smtp_user ? { user: s.smtp_user, pass: s.smtp_pass } : undefined,
    pool: true,
    maxConnections: 2,
  });
  smtpCache = { key, transport };
  return transport;
}

/**
 * Plain-text twin of the HTML body. Spam filters score HTML-only mail worse, and
 * some phone mail apps preview the text part; keep it readable.
 */
function textVersion(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&middot;/g, "-").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function send(opts: MailMessage, settings?: EmailSettings) {
  const s = settings ?? (await getEmailSettings());
  const from = s.from || "Tickets <onboarding@resend.dev>";
  const text = textVersion(opts.html);
  if (s.provider === "dry-run") {
    console.log(`[email:dry-run] to=${opts.to} subject="${opts.subject}" attachments=${opts.attachments?.length ?? 0}`);
    return { ok: true, dryRun: true as const, provider: s.provider };
  }
  if (s.provider === "smtp") {
    await smtp(s).sendMail({
      from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text,
      attachments: opts.attachments?.map((a) => ({ filename: a.filename, content: a.content, contentType: "application/pdf" })),
    });
    return { ok: true, dryRun: false as const, provider: s.provider };
  }
  const resend = new Resend(s.resend_api_key);
  const { error } = await resend.emails.send({ from, text, ...opts });
  if (error) throw new Error(`Email failed: ${error.message}`);
  return { ok: true, dryRun: false as const, provider: s.provider };
}

/** Connection check plus a short message, used by the Settings page "Send test" button. */
export async function sendTestEmail(to: string, settings: EmailSettings) {
  if (settings.provider === "smtp") {
    await smtp(settings).verify();
  }
  return send(
    {
      to,
      subject: `Drift Tickets email test ${new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" })}`,
      html: `<p>This is a test message from the Drift Tickets system.</p><p>If you can read this, outbound email is configured correctly (provider: ${settings.provider}).</p>`,
    },
    settings,
  );
}

export async function sendTicketsEmail(b: OrderBundle, pdf: Uint8Array) {
  if (!b.order.buyer_email) return { ok: false, reason: "no email" as const };
  const rows = b.tickets
    .map(
      (t) =>
        `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">${t.ticket_type.name}</td>
         <td style="padding:6px 10px;border-bottom:1px solid #eee"><b>${t.number}</b></td>
         <td style="padding:6px 10px;border-bottom:1px solid #eee">${t.holder_name ?? ""}</td></tr>`,
    )
    .join("");
  const html = `
  <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#111">
    <h2 style="margin-bottom:4px">${b.event.name}</h2>
    <p style="margin-top:0;color:#555">Your payment has been verified. Your tickets and receipt are attached.</p>
    <p>Order <b>#${b.order.order_no}</b> &middot; Total <b>${php(b.order.total_centavos)}</b></p>
    <table style="border-collapse:collapse;width:100%">
      <thead><tr style="text-align:left;background:#f5f5f5">
        <th style="padding:6px 10px">Ticket</th><th style="padding:6px 10px">Wristband No.</th><th style="padding:6px 10px">Holder</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="margin-top:20px">At the venue, show the QR code for each ticket (in the attached PDF or at the link below). Staff will scan it and hand you the matching wristband${b.tickets.some((t) => t.ticket_type.includes_shirt) ? " and t-shirt" : ""}.</p>
    <p><a href="${SITE_URL}/order/${b.order.id}" style="background:#111;color:#fff;padding:10px 16px;text-decoration:none;border-radius:6px;display:inline-block">View my tickets online</a></p>
    <p style="color:#777;font-size:12px">Each QR code admits one person once. Do not share screenshots of your QR codes.</p>
    <p style="color:#777;font-size:12px">Found this in Spam or Promotions? Mark it as "Not spam" or move it to your inbox so future updates about your order arrive normally.</p>
  </div>`;
  return send({
    to: b.order.buyer_email,
    subject: `Your tickets - ${b.event.name} (Order #${b.order.order_no})`,
    html,
    attachments: [{ filename: `tickets-order-${b.order.order_no}.pdf`, content: Buffer.from(pdf) }],
  });
}

export async function sendRejectionEmail(b: OrderBundle, reason: string) {
  if (!b.order.buyer_email) return { ok: false, reason: "no email" as const };
  const html = `
  <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#111">
    <h2>${b.event.name}</h2>
    <p>We could not verify the payment for order <b>#${b.order.order_no}</b>.</p>
    <p style="background:#fff4f4;border:1px solid #f3c2c2;padding:10px;border-radius:6px"><b>Reason:</b> ${reason}</p>
    <p>If you believe this is a mistake, reply to this email with your payment screenshot and reference number, or place a new order at <a href="${SITE_URL}">${SITE_URL}</a>.</p>
  </div>`;
  return send({ to: b.order.buyer_email, subject: `Payment not verified - Order #${b.order.order_no}`, html });
}
