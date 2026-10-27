"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertSystem } from "@/lib/auth";
import { deliver } from "@/lib/email";
import { deliverOrder } from "@/lib/issue";
import { staleReason, type EmailKind, type OutboxStatus } from "@/lib/outbox";
import { buildOrderPdf } from "@/lib/pdf/ticket-pdf";
import { getOrderBundle } from "@/lib/queries";
import { getEmailSettings, type EmailSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import type { OrderStatus } from "@/lib/supabase/types";
import type { ActionResult } from "./orders";

/** One click sends at most this many, so a long backlog cannot run past the request time limit. */
const BATCH = 20;

/** The order column each kind stamps once it is out, so the cron does not send it again. */
const STAMP: Partial<Record<EmailKind, string>> = {
  tickets: "email_sent_at",
  converted: "email_sent_at",
  expiry: "expiry_notice_sent_at",
  reminder: "reminder_sent_at",
};

type Row = {
  id: number; kind: EmailKind; order_id: string | null; to_email: string; subject: string; html: string;
  has_pdf: boolean; status: OutboxStatus; attempts: number;
  order: { status: OrderStatus; expires_at: string | null } | null;
};

/** Sends one outbox row. Returns how it ended; never throws. */
async function sendRow(row: Row, s: EmailSettings): Promise<"sent" | "failed" | "skipped"> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const stale = staleReason(row.kind, row.order);
  if (stale) {
    await admin.from("email_outbox").update({ status: "skipped", error: stale, updated_at: now }).eq("id", row.id);
    return "skipped";
  }
  try {
    if (row.kind === "tickets" && row.order_id) {
      // Built fresh, so the email and PDF list the tickets that are valid today.
      // send() inside finds this held or failed row and marks it sent; a resend of
      // one already sent is logged as a new row.
      const r = await deliverOrder(row.order_id);
      if (!r.emailed) throw new Error("The order has no email address.");
      return "sent";
    }
    let attachments: { filename: string; content: Buffer }[] | undefined;
    if (row.has_pdf && row.order_id) {
      const bundle = await getOrderBundle(row.order_id);
      if (!bundle) throw new Error("The order no longer exists.");
      attachments = [{ filename: `tickets-order-${bundle.order.order_no}.pdf`, content: Buffer.from(await buildOrderPdf(bundle)) }];
    }
    await deliver({ to: row.to_email, subject: row.subject, html: row.html, attachments }, s);
    await admin.from("email_outbox").update({ status: "sent", error: null, attempts: row.attempts + 1, sent_at: now, provider: s.provider, updated_at: now }).eq("id", row.id);
    const stamp = STAMP[row.kind];
    if (stamp && row.order_id) await admin.from("orders").update({ [stamp]: now }).eq("id", row.order_id);
    return "sent";
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    await admin.from("email_outbox").update({ status: "failed", error, attempts: row.attempts + 1, provider: s.provider, updated_at: now }).eq("id", row.id);
    return "failed";
  }
}

const SELECT = "id, kind, order_id, to_email, subject, html, has_pdf, status, attempts, order:orders(status, expires_at)";

function summary(done: Record<"sent" | "failed" | "skipped", number>, left: number): string {
  const parts = [`${done.sent} sent`];
  if (done.failed) parts.push(`${done.failed} failed (see the reason on each)`);
  if (done.skipped) parts.push(`${done.skipped} skipped, no longer relevant`);
  if (left > 0) parts.push(`${left} more waiting: press Send again`);
  return parts.join(", ") + ".";
}

async function run(rows: Row[], left: number): Promise<ActionResult> {
  const s = await getEmailSettings();
  if (s.provider === "dry-run") return { ok: false, error: "No email provider is set up yet. Save the SMTP settings above first, then send." };
  const done = { sent: 0, failed: 0, skipped: 0 };
  for (const row of rows) done[await sendRow(row, s)]++;
  revalidatePath("/admin/settings");
  return { ok: true, warning: summary(done, left) };
}

/** Send (or resend) the chosen outbox emails. */
export async function sendOutboxEmails(ids: number[]): Promise<ActionResult> {
  try {
    await assertSystem();
    const list = z.array(z.number().int().positive()).min(1).max(BATCH).parse(ids);
    const { data, error } = await createAdminClient().from("email_outbox").select(SELECT).in("id", list).order("id");
    if (error) return { ok: false, error: error.message };
    return run((data ?? []) as unknown as Row[], 0);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not send" };
  }
}

/** Send everything held or failed, oldest first, one batch per click. */
export async function sendAllWaiting(): Promise<ActionResult> {
  try {
    await assertSystem();
    const { data, error, count } = await createAdminClient()
      .from("email_outbox")
      .select(SELECT, { count: "exact" })
      .in("status", ["held", "failed"])
      .order("id")
      .limit(BATCH);
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as unknown as Row[];
    if (rows.length === 0) return { ok: true, warning: "Nothing waiting." };
    return run(rows, Math.max(0, (count ?? rows.length) - rows.length));
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not send" };
  }
}

/** The stored body of one email, for the preview. */
export async function outboxEmailHtml(id: number): Promise<{ ok: true; html: string } | { ok: false; error: string }> {
  try {
    await assertSystem();
    const { data, error } = await createAdminClient().from("email_outbox").select("html").eq("id", z.number().int().positive().parse(id)).maybeSingle();
    if (error || !data) return { ok: false, error: error?.message ?? "Not found" };
    return { ok: true, html: data.html as string };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not load" };
  }
}
