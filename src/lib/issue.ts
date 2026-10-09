import { createAdminClient } from "@/lib/supabase/admin";
import { newQrToken } from "@/lib/tokens";
import { getOrderBundle } from "@/lib/queries";
import { buildOrderPdf } from "@/lib/pdf/ticket-pdf";
import { sendConvertedEmail, sendTicketsEmail } from "@/lib/email";
import type { PaymentMethod } from "@/lib/supabase/types";

/**
 * Marks the order paid, pulls wristband numbers from the pool, creates tickets,
 * assigns the receipt number, then builds the PDF and emails it.
 * Safe to call once per order; the DB function refuses to re-issue a paid order.
 */
export async function issueOrder(opts: {
  orderId: string;
  actorId: string | null;
  paymentMethod: PaymentMethod | null;
  paymentReference: string | null;
}) {
  const admin = createAdminClient();

  const { data: items, error: itemsErr } = await admin
    .from("order_items")
    .select("qty")
    .eq("order_id", opts.orderId);
  if (itemsErr) throw new Error(itemsErr.message);
  const count = (items ?? []).reduce((n, i) => n + i.qty, 0);
  const tokens = Array.from({ length: count }, newQrToken);

  const { error } = await admin.rpc("issue_order_tickets", {
    p_order_id: opts.orderId,
    p_actor: opts.actorId,
    p_payment_method: opts.paymentMethod,
    p_payment_reference: opts.paymentReference,
    p_tokens: tokens,
  });
  if (error) throw new Error(error.message);

  // Tickets are now issued and the order is paid. Delivery problems (PDF, email)
  // must not be reported as a failed approval; they are surfaced as a warning and
  // staff can re-send from the order page.
  try {
    const r = await deliverOrder(opts.orderId);
    return { emailed: r.emailed, deliveryError: null as string | null };
  } catch (e) {
    console.error(`[issue] delivery failed for order ${opts.orderId}:`, e);
    return { emailed: false, deliveryError: e instanceof Error ? e.message : "delivery failed" };
  }
}

/** (Re)sends the ticket email for a paid order. */
export async function deliverOrder(orderId: string) {
  const admin = createAdminClient();
  const bundle = await getOrderBundle(orderId);
  if (!bundle) throw new Error("Order not found after issue");
  if (bundle.order.status !== "paid") throw new Error("Order is not paid");

  const pdf = await buildOrderPdf(bundle);
  const result = await sendTicketsEmail(bundle, pdf);
  if (result.ok) {
    await admin.from("orders").update({ email_sent_at: new Date().toISOString() }).eq("id", orderId);
  }
  return { bundle, emailed: result.ok };
}

/**
 * Sends the replacement tickets after a conversion. Uses its own template so the
 * buyer is told which wristband numbers stopped working and what is still owed,
 * rather than a second "your payment has been verified" mail.
 */
export async function deliverConversion(
  orderId: string,
  opts: { from: { number: string; type: string }[]; reason: string; balanceCentavos: number; kept?: number },
) {
  const admin = createAdminClient();
  const bundle = await getOrderBundle(orderId);
  if (!bundle) throw new Error("Order not found after converting");

  const pdf = await buildOrderPdf(bundle);
  const result = await sendConvertedEmail(bundle, pdf, opts);
  if (result.ok) {
    await admin.from("orders").update({ email_sent_at: new Date().toISOString() }).eq("id", orderId);
  }
  return { bundle, emailed: result.ok };
}
