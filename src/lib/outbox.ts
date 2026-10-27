import { createAdminClient } from "@/lib/supabase/admin";
import type { OrderStatus } from "@/lib/supabase/types";

/**
 * The email outbox (table email_outbox, Admin > Settings > Email). Every buyer
 * email lands here: sent, failed, or held because no provider is set up yet.
 */
export type EmailKind = "received" | "reminder" | "expiry" | "tickets" | "converted" | "voided" | "rejected";
export type OutboxStatus = "held" | "sent" | "failed" | "skipped";

export interface OutboxRow {
  id: number;
  created_at: string;
  kind: EmailKind;
  order_id: string | null;
  to_email: string;
  subject: string;
  has_pdf: boolean;
  status: OutboxStatus;
  error: string | null;
  attempts: number;
  sent_at: string | null;
  order: { order_no: number; status: OrderStatus } | null;
}

/**
 * Kinds an order gets at most one of. A held or failed one is updated in place
 * when the same email is tried again (the cron retries the expiry notice every
 * run), instead of piling up copies.
 */
const ONE_PER_ORDER: ReadonlySet<EmailKind> = new Set(["received", "reminder", "expiry", "tickets"]);

/**
 * Writes one email to the outbox. Never throws: a missing table (migration not
 * run yet) or a database hiccup must not stop the email itself.
 */
export async function recordEmail(
  m: { to: string; subject: string; html: string; attachments?: unknown[]; kind?: EmailKind; orderId?: string },
  r: { status: "held" | "sent" | "failed"; provider?: string; error?: string },
): Promise<void> {
  if (!m.kind) return;
  // A countdown is stale long before anyone could send it by hand.
  if (r.status === "held" && m.kind === "reminder") return;
  try {
    const admin = createAdminClient();
    const now = new Date().toISOString();
    const tried = r.status === "held" ? 0 : 1;
    const row = {
      kind: m.kind,
      order_id: m.orderId ?? null,
      to_email: m.to,
      subject: m.subject,
      html: m.html,
      has_pdf: (m.attachments?.length ?? 0) > 0,
      status: r.status,
      error: r.error?.slice(0, 500) ?? null,
      provider: r.provider ?? null,
      sent_at: r.status === "sent" ? now : null,
      updated_at: now,
    };
    if (m.orderId && ONE_PER_ORDER.has(m.kind)) {
      const { data: prev } = await admin
        .from("email_outbox")
        .select("id, attempts")
        .eq("order_id", m.orderId)
        .eq("kind", m.kind)
        .in("status", ["held", "failed"])
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (prev) {
        const { error } = await admin.from("email_outbox").update({ ...row, attempts: prev.attempts + tried }).eq("id", prev.id);
        if (error) console.error("[outbox] update failed:", error.message);
        return;
      }
    }
    const { error } = await admin.from("email_outbox").insert({ ...row, attempts: tried });
    if (error) console.error("[outbox] insert failed:", error.message);
  } catch (e) {
    console.error("[outbox] could not record email:", e);
  }
}

/**
 * Why a held email should not go out any more, or null when it still makes sense.
 * "Pay within 60 minutes" is wrong once the buyer has paid or the hold has run out,
 * and a ticket email needs the order to still be paid.
 */
export function staleReason(kind: EmailKind, order: { status: OrderStatus; expires_at: string | null } | null): string | null {
  if (!order) return null;
  if (kind === "received" || kind === "reminder") {
    if (order.status !== "pending_payment") return "The order is past the payment step.";
    if (order.expires_at && new Date(order.expires_at).getTime() < Date.now()) return "The payment timer has run out.";
  }
  if ((kind === "tickets" || kind === "converted") && order.status !== "paid") return "The order is no longer paid.";
  return null;
}
