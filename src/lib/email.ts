import { Resend } from "resend";
import { SHIPPING_NOTE, shirtShips } from "@/lib/shipping";
import nodemailer, { type Transporter } from "nodemailer";
import { SITE_URL, primaryAccountName, primaryChannel } from "@/config/event";
import { getRules } from "@/lib/rules";
import { TERMS_DEFAULTS, type Rules, type Terms } from "@/lib/rules-types";
import { LOCALE } from "@/config/site";
import { php } from "@/lib/money";
import { getEmailSettings, type EmailSettings } from "@/lib/settings";
import type { OrderBundle } from "@/lib/queries";
import { carNameOf, itemLabel } from "@/lib/items";
import { recordEmail, type EmailKind } from "@/lib/outbox";

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  attachments?: { filename: string; content: Buffer }[];
  /** Which buyer email this is, so it lands in the outbox. Test emails leave it out. */
  kind?: EmailKind;
  orderId?: string;
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

/**
 * Sends one email and writes it to the outbox (Admin > Settings > Email). With no
 * provider set up it is held there instead, to be sent from Settings later.
 */
export async function send(opts: MailMessage, settings?: EmailSettings) {
  const s = settings ?? (await getEmailSettings());
  if (s.provider === "dry-run") {
    console.log(`[email:dry-run] to=${opts.to} subject="${opts.subject}" attachments=${opts.attachments?.length ?? 0}`);
    await recordEmail(opts, { status: "held" });
    return { ok: true, dryRun: true as const, provider: s.provider };
  }
  try {
    await deliver(opts, s);
  } catch (e) {
    await recordEmail(opts, { status: "failed", provider: s.provider, error: e instanceof Error ? e.message : String(e) });
    throw e;
  }
  await recordEmail(opts, { status: "sent", provider: s.provider });
  return { ok: true, dryRun: false as const, provider: s.provider };
}

/** Hands one message to the configured provider. Throws when it is refused; never records anything. */
export async function deliver(opts: Pick<MailMessage, "to" | "subject" | "html" | "attachments">, s: EmailSettings) {
  if (s.provider === "dry-run") throw new Error("No email provider is set up yet. Save SMTP settings first.");
  const from = s.from || "Tickets <onboarding@resend.dev>";
  const text = textVersion(opts.html);
  if (s.provider === "smtp") {
    await smtp(s).sendMail({
      from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text,
      attachments: opts.attachments?.map((a) => ({ filename: a.filename, content: a.content, contentType: "application/pdf" })),
    });
    return;
  }
  const resend = new Resend(s.resend_api_key);
  const { error } = await resend.emails.send({ from, text, to: opts.to, subject: opts.subject, html: opts.html, attachments: opts.attachments });
  if (error) throw new Error(`Email failed: ${error.message}`);
}

/** Connection check plus a short message, used by the Settings page "Send test" button. */
export async function sendTestEmail(to: string, settings: EmailSettings) {
  if (settings.provider === "smtp") {
    await smtp(settings).verify();
  }
  return send(
    {
      to,
      subject: `Ticketing email test ${new Date().toLocaleString(LOCALE.locale, { timeZone: LOCALE.timeZone })}`,
      html: `<p>This is a test message from the ticketing system.</p><p>If you can read this, outbound email is configured correctly (provider: ${settings.provider}).</p>`,
    },
    settings,
  );
}

/** The shirt that ships and where to, for the buyer's emails. Empty when nothing ships. */
function shippingBlockHtml(b: OrderBundle): string {
  const s = b.order.shipping;
  if (!s) return "";
  const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return `<div style="margin-top:16px;padding:12px 14px;border:1px solid #d8ccff;background:#f7f4ff;border-radius:8px">
      <p style="margin:0 0 6px;font-weight:bold">Your shirt ships to</p>
      <p style="margin:0">${esc(s.name)} &middot; ${esc(s.mobile)}<br>${esc(s.address)}<br>${esc(s.city)}, ${esc(s.province)} ${esc(s.zip)}<br>via ${esc(s.courier)}</p>
      <p style="margin:8px 0 0;color:#555;font-size:13px">${SHIPPING_NOTE}</p>
    </div>`;
}

export async function sendTicketsEmail(b: OrderBundle, pdf: Uint8Array) {
  if (!b.order.buyer_email) return { ok: false, reason: "no email" as const };
  const { terms: T } = await getRules();
  const shirtAtGate = b.tickets.some((t) => t.ticket_type.includes_shirt && !t.included && !shirtShips(t.ticket_type, b.order));
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
        <th style="padding:6px 10px">Ticket</th><th style="padding:6px 10px">${T.numberLabel}</th><th style="padding:6px 10px">Holder</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="margin-top:20px">At the venue, show the QR code for each ticket (in the attached PDF or at the link below). ${T.physical ? `Staff will scan it and hand you the matching ${T.one}${shirtAtGate ? " and t-shirt" : ""}.` : `Staff will scan it at the gate${shirtAtGate ? " and hand you your t-shirt" : ""}.`}</p>
    ${shippingBlockHtml(b)}
    <p><a href="${SITE_URL}/order/${b.order.id}" style="background:#111;color:#fff;padding:10px 16px;text-decoration:none;border-radius:6px;display:inline-block">View my tickets online</a></p>
    <p style="color:#777;font-size:12px">Each QR code admits one person once. Do not share screenshots of your QR codes.</p>
    <p style="color:#777;font-size:12px">Found this in Spam or Promotions? Mark it as "Not spam" or move it to your inbox so future updates about your order arrive normally.</p>
  </div>`;
  return send({
    to: b.order.buyer_email,
    subject: `Your tickets - ${b.event.name} (Order #${b.order.order_no})`,
    html,
    attachments: [{ filename: `tickets-order-${b.order.order_no}.pdf`, content: Buffer.from(pdf) }],
    kind: "tickets",
    orderId: b.order.id,
  });
}

/**
 * Sent the moment an order is placed, before payment. Gives the buyer a way back
 * to the pay page if they close the browser while paying in their bank app.
 */
export async function sendOrderReceivedEmail(b: OrderBundle) {
  if (!b.order.buyer_email) return { ok: false, reason: "no email" as const };
  const { paymentWindowMinutes: PAYMENT_WINDOW_MINUTES, channels, extraChannels, terms: T } = await getRules();
  const total = php(b.order.total_centavos);
  const deadline = b.order.expires_at
    ? new Date(b.order.expires_at).toLocaleString(LOCALE.locale, { timeZone: LOCALE.timeZone, dateStyle: "medium", timeStyle: "short" })
    : null;
  const payUrl = `${SITE_URL}/pay/${b.order.id}`;
  const rows = b.items
    .map(
      (it) =>
        `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">${itemLabel(it, true, carNameOf(b.items)).replace(" x ", " &times; ")}</td>
         <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${php(it.qty * it.unit_price_centavos)}</td></tr>`,
    )
    .join("");
  const account = primaryAccountName(b.event, extraChannels) ? ` (account name: <b>${primaryAccountName(b.event, extraChannels)}</b>)` : "";
  const html = `
  <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#111">
    <h2 style="margin-bottom:4px">${b.event.name}</h2>
    <p style="margin-top:0;color:#555">We received your order <b>#${b.order.order_no}</b>. It is <b>not paid yet</b>.</p>
    <table style="border-collapse:collapse;width:100%">${rows}
      <tr><td style="padding:8px 10px;font-weight:bold">Total to pay</td><td style="padding:8px 10px;text-align:right;font-weight:bold">${total}</td></tr>
    </table>
    <ol style="padding-left:20px;line-height:1.6">
      <li>Pay exactly <b>${total}</b> via ${primaryChannel(b.event, channels, extraChannels).payVia}${account}. The QR code is on the payment page below.</li>
      <li>Take a screenshot of the confirmation and upload it, with the reference number, on the same page.</li>
    </ol>
    ${deadline ? `<p style="background:#fff7e0;border:1px solid #f1d58a;padding:10px;border-radius:6px"><b>Please finish within ${PAYMENT_WINDOW_MINUTES} minutes</b>, by ${deadline}. <b>After that the order is cancelled</b> and the ${T.many} are released to other buyers, so pay and upload before the deadline.</p>` : ""}
    <p><a href="${payUrl}" style="background:#111;color:#fff;padding:12px 18px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:bold">Pay and upload proof</a></p>
    <p style="color:#555;font-size:13px">Bayaran ang eksaktong <b>${total}</b> via ${primaryChannel(b.event, channels, extraChannels).app}, i-screenshot ang confirmation, at i-upload sa link sa itaas. Kapag na-verify, ipapadala ang tickets sa email na ito.</p>
    ${shippingBlockHtml(b)}
    <p style="color:#777;font-size:12px">After we verify your payment, your receipt and QR tickets are emailed here within 24 hours. Check your order any time: <a href="${SITE_URL}/order/${b.order.id}">${SITE_URL}/order/${b.order.id}</a></p>
    <p style="color:#777;font-size:12px">Found this in Spam or Promotions? Mark it as "Not spam" so your tickets land in your inbox.</p>
  </div>`;
  return send({ to: b.order.buyer_email, subject: `Order #${b.order.order_no} received - pay ${total}${deadline ? ` within ${PAYMENT_WINDOW_MINUTES} minutes` : ""}`, html, kind: "received", orderId: b.order.id });
}

/**
 * Sent a few minutes before the hold runs out, to a buyer who has not uploaded
 * proof yet. The most common reason an order dies is simply that the buyer got
 * pulled away mid-payment, so this recovers sales rather than chasing anyone.
 */
export async function sendPaymentReminderEmail(b: OrderBundle, minutesLeft: number) {
  if (!b.order.buyer_email) return { ok: false, reason: "no email" as const };
  const total = php(b.order.total_centavos);
  return send({ to: b.order.buyer_email, subject: `${minutesLeft} minutes left to pay ${total} - Order #${b.order.order_no}`, html: await getRules().then((r) => paymentReminderHtml(b, minutesLeft, r.channels, r.extraChannels, r.terms)), kind: "reminder", orderId: b.order.id });
}

/** Body of the reminder, split out from sending so it can be previewed without mailing anyone. */
export function paymentReminderHtml(b: OrderBundle, minutesLeft: number, channels: Rules["channels"], extraChannels: Rules["extraChannels"] = [], T: Terms = TERMS_DEFAULTS): string {
  const total = php(b.order.total_centavos);
  const payUrl = `${SITE_URL}/pay/${b.order.id}`;
  const account = primaryAccountName(b.event, extraChannels) ? ` (account name: <b>${primaryAccountName(b.event, extraChannels)}</b>)` : "";
  return `
  <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#111">
    <h2 style="margin-bottom:4px">${b.event.name}</h2>
    <p style="margin-top:0;color:#555">Your ${T.many} for order <b>#${b.order.order_no}</b> are still on hold, but not for much longer.</p>
    <p style="background:#fff7e0;border:1px solid #f1d58a;padding:10px;border-radius:6px">
      <b>About ${minutesLeft} minutes left</b> to pay ${total} via ${primaryChannel(b.event, channels, extraChannels).payVia}${account} and upload your screenshot.
    </p>
    <p><a href="${payUrl}" style="background:#111;color:#fff;padding:12px 18px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:bold">Pay and upload proof</a></p>
    <p style="color:#555;font-size:13px">May <b>${minutesLeft} minuto</b> pa bago matapos ang hold sa ${T.many} mo. Bayaran ang eksaktong ${total} via ${primaryChannel(b.event, channels, extraChannels).app} at i-upload ang screenshot sa link sa itaas.</p>
    <p style="color:#777;font-size:12px">Already paid? Just upload the screenshot and reference number on that page; you do not need to pay again. <b>When the timer ends the order is cancelled</b> and the ${T.many} go back to the pool, so upload before then.</p>
  </div>`;
}

/**
 * Sent once the hold has lapsed. Expiry is final, so this does not offer a way
 * back into the order. It still has to reach the buyer who already paid, whose
 * only route now is the organizer, and it has to stop them paying twice.
 */
export async function sendExpiryNoticeEmail(b: OrderBundle) {
  if (!b.order.buyer_email) return { ok: false, reason: "no email" as const };
  return send({ to: b.order.buyer_email, subject: `Order #${b.order.order_no} was cancelled: the payment timer ran out`, html: expiryNoticeHtml(b, (await getRules()).terms), kind: "expiry", orderId: b.order.id });
}

/** Body of the expiry notice, split out from sending so it can be previewed without mailing anyone. */
export function expiryNoticeHtml(b: OrderBundle, T: Terms = TERMS_DEFAULTS): string {
  const orderUrl = `${SITE_URL}/order/${b.order.id}`;
  // The label is a full instruction like "Call or text Tintin Sy - 0917...", so it
  // has to stand on its own line rather than be dropped mid-sentence.
  const support =
    b.event.support_contact_label && b.event.support_contact_url
      ? `<br><a href="${b.event.support_contact_url}" style="font-size:16px"><b>${b.event.support_contact_label}</b></a>`
      : "";
  return `
  <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#111">
    <h2 style="margin-bottom:4px">${b.event.name}</h2>
    <p style="margin-top:0;color:#555">The payment timer on order <b>#${b.order.order_no}</b> ran out, so the order was cancelled and the ${T.many} went back to the pool.</p>
    <p style="background:#fff1f0;border:1px solid #f3c2bd;padding:10px;border-radius:6px">
      <b>Already paid? Do not pay again.</b> Reach the organizer with your order number <b>#${b.order.order_no}</b> and your payment reference, and they will sort it out for you.${support}
    </p>
    <p><b>Not paid yet?</b> Nothing was charged. You are welcome to place a new order while tickets last.</p>
    <p><a href="${SITE_URL}" style="background:#111;color:#fff;padding:12px 18px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:bold">Place a new order</a></p>
    <p style="color:#555;font-size:13px">Tapos na ang oras kaya kanselado na ang order at naibalik na sa pool ang ${T.many}. <b>Kung nakabayad ka na, huwag nang magbayad ulit.</b> Kontakin ang organizer, sabihin ang order number #${b.order.order_no} at ang reference number mo. Kung hindi ka pa nakakabayad, walang nasingil sa iyo at pwede ka nang mag-order ulit.</p>
    <p style="color:#777;font-size:12px">Your cancelled order stays viewable here: <a href="${orderUrl}">${orderUrl}</a></p>
  </div>`;
}

/**
 * Sent when staff void one or more issued tickets (wrong approval, duplicate
 * payment, buyer request). Lists the affected wristband numbers and the reason,
 * and points to the organizer contact for refunds or disputes.
 */
export async function sendVoidEmail(b: OrderBundle, voided: OrderBundle["tickets"], reason: string) {
  if (!b.order.buyer_email || voided.length === 0) return { ok: false, reason: "no email" as const };
  const { terms: T } = await getRules();
  const all = b.tickets.length > 0 && b.tickets.every((t) => t.status === "void");
  const rows = voided
    .map((t) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">${t.ticket_type.name}</td><td style="padding:6px 10px;border-bottom:1px solid #eee"><b>${t.number}</b></td><td style="padding:6px 10px;border-bottom:1px solid #eee">${t.holder_name ?? ""}</td></tr>`)
    .join("");
  const contact = b.event.support_contact_label
    ? `<p>Questions or a refund? ${b.event.support_contact_url ? `<a href="${b.event.support_contact_url}">${b.event.support_contact_label}</a>` : b.event.support_contact_label} and mention order <b>#${b.order.order_no}</b>.</p>`
    : `<p>Questions or a refund? Reply to this email and mention order <b>#${b.order.order_no}</b>.</p>`;
  const html = `
  <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#111">
    <h2 style="margin-bottom:4px">${b.event.name}</h2>
    <p style="margin-top:0;color:#555">${all ? "All tickets in" : `${voided.length} ticket${voided.length === 1 ? "" : "s"} in`} order <b>#${b.order.order_no}</b> ${voided.length === 1 && !all ? "has" : "have"} been <b>voided</b> and will not be accepted at the gate.</p>
    <p style="background:#fff4f4;border:1px solid #f3c2c2;padding:10px;border-radius:6px"><b>Reason:</b> ${reason}</p>
    <table style="border-collapse:collapse;width:100%">
      <thead><tr style="text-align:left;background:#f5f5f5"><th style="padding:6px 10px">Ticket</th><th style="padding:6px 10px">${T.numberLabel}</th><th style="padding:6px 10px">Holder</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${all ? "" : `<p>Your other tickets in this order stay valid. The updated PDF is at <a href="${SITE_URL}/order/${b.order.id}">${SITE_URL}/order/${b.order.id}</a>.</p>`}
    ${contact}
    <p style="color:#555;font-size:13px">Na-void ang ${all ? "lahat ng tickets" : "ilang tickets"} sa order #${b.order.order_no}. Kung may tanong o refund, kontakin ang organizer at banggitin ang order number.</p>
  </div>`;
  return send({ to: b.order.buyer_email, subject: `Ticket${voided.length === 1 ? "" : "s"} voided - ${b.event.name} (Order #${b.order.order_no})`, html, kind: "voided", orderId: b.order.id });
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
  return send({ to: b.order.buyer_email, subject: `Payment not verified - Order #${b.order.order_no}`, html, kind: "rejected", orderId: b.order.id });
}

/**
 * Sent after staff swap a paid order to a different ticket type. The buyer keeps
 * the same order number, so the mail leads with what changed and what is still
 * owed either way, then attaches the replacement tickets.
 */
export async function sendConvertedEmail(
  b: OrderBundle,
  pdf: Uint8Array,
  opts: { from: { number: string; type: string }[]; reason: string; balanceCentavos: number; kept?: number },
) {
  if (!b.order.buyer_email) return { ok: false, reason: "no email" as const };
  const { terms: T } = await getRules();
  // A partial change leaves the buyer's other tickets as they were.
  const kept = opts.kept ?? 0;
  const many = opts.from.length !== 1;
  const oldRows = opts.from.map((t) => `<li>${t.type} &middot; <b>${t.number}</b></li>`).join("");
  const newRows = b.tickets
    .filter((t) => t.status !== "void")
    .map(
      (t) =>
        `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">${t.ticket_type.name}</td>
         <td style="padding:6px 10px;border-bottom:1px solid #eee"><b>${t.number}</b></td>
         <td style="padding:6px 10px;border-bottom:1px solid #eee">${t.holder_name ?? ""}</td></tr>`,
    )
    .join("");
  const contact = b.event.support_contact_label
    ? `${b.event.support_contact_url ? `<a href="${b.event.support_contact_url}">${b.event.support_contact_label}</a>` : b.event.support_contact_label}`
    : "reply to this email";
  const money =
    opts.balanceCentavos > 0
      ? `<p style="background:#eefaf0;border:1px solid #bfe6c8;padding:10px;border-radius:6px"><b>${php(opts.balanceCentavos)} will be returned to you.</b> The organizer will send it back to the account you paid from. If it has not arrived in a few days, ${contact} and mention order #${b.order.order_no}.</p>`
      : opts.balanceCentavos < 0
        ? `<p style="background:#fff7e0;border:1px solid #f1d58a;padding:10px;border-radius:6px"><b>${php(-opts.balanceCentavos)} is still to be paid.</b> ${contact === "reply to this email" ? "Reply to this email" : contact} to arrange it, and mention order #${b.order.order_no}. Your new tickets below are already valid.</p>`
        : "";
  const html = `
  <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#111">
    <h2 style="margin-bottom:4px">${b.event.name}</h2>
    <p style="margin-top:0;color:#555">${kept
      ? `${many ? "Some tickets" : "A ticket"} in your order <b>#${b.order.order_no}</b> ${many ? "were" : "was"} changed to a different ticket. The old ${T.one} number${many ? "s" : ""} below will <b>not</b> work at the gate any more; your other ${kept === 1 ? "ticket stays" : `${kept} tickets stay`} as before.`
      : `Your order <b>#${b.order.order_no}</b> has been changed to a different ticket. Your old ${T.one} number${many ? "s" : ""} below will <b>not</b> work at the gate any more.`}</p>
    <p style="background:#f5f5f5;padding:10px;border-radius:6px"><b>Reason:</b> ${opts.reason}</p>
    ${oldRows ? `<p style="margin-bottom:4px;color:#555">No longer valid:</p><ul style="margin-top:0;color:#555">${oldRows}</ul>` : ""}
    <p style="margin-bottom:4px"><b>${kept ? "Your tickets now" : `Your new ticket${b.tickets.filter((t) => t.status !== "void").length === 1 ? "" : "s"}`}</b> &middot; new total ${php(b.order.total_centavos)}</p>
    <table style="border-collapse:collapse;width:100%">
      <thead><tr style="text-align:left;background:#f5f5f5">
        <th style="padding:6px 10px">Ticket</th><th style="padding:6px 10px">${T.numberLabel}</th><th style="padding:6px 10px">Holder</th>
      </tr></thead>
      <tbody>${newRows}</tbody>
    </table>
    ${money}
    <p style="margin-top:20px">Show the QR code in the attached PDF at the gate. Please delete or ignore the older PDF.</p>
    <p><a href="${SITE_URL}/order/${b.order.id}" style="background:#111;color:#fff;padding:10px 16px;text-decoration:none;border-radius:6px;display:inline-block">View my tickets online</a></p>
    <p style="color:#555;font-size:13px">${kept
      ? `May napalitang ticket sa order #${b.order.order_no}. Hindi na gagana ang lumang ${T.one} number na nakalista sa itaas; pareho pa rin ang iba mong tickets. Nasa PDF na nakalakip ang lahat ng tickets mo.`
      : `Napalitan ang ticket sa order #${b.order.order_no}. Hindi na gagana ang lumang ${T.one} number; nasa PDF na nakalakip ang bago.`}</p>
  </div>`;
  return send({
    to: b.order.buyer_email,
    subject: `Your ticket was changed - ${b.event.name} (Order #${b.order.order_no})`,
    html,
    attachments: [{ filename: `tickets-order-${b.order.order_no}.pdf`, content: Buffer.from(pdf) }],
    kind: "converted",
    orderId: b.order.id,
  });
}
