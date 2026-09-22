"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrderBundle } from "@/lib/queries";
import { audit } from "@/lib/audit";
import { issueOrder, deliverOrder, deliverConversion } from "@/lib/issue";
import { sendRejectionEmail, sendVoidEmail } from "@/lib/email";
import { itemLabel } from "@/lib/items";
import { newQrToken } from "@/lib/tokens";
import type { OrderStatus, TicketStatus, TicketTypeRow } from "@/lib/supabase/types";
import type { ActionResult } from "./orders";

function fail(e: unknown): ActionResult {
  return { ok: false, error: e instanceof Error ? e.message : "Something went wrong" };
}

/* ----------------------------------------------------------- verification */
export async function approveOrder(orderId: string): Promise<ActionResult> {
  try {
    const { userId } = await assertStaff("staff");
    const bundle = await getOrderBundle(orderId);
    if (!bundle) return { ok: false, error: "Order not found" };
    if (bundle.order.status !== "awaiting_verification" && bundle.order.status !== "pending_payment")
      return { ok: false, error: `Order is ${bundle.order.status}` };
    const r = await issueOrder({
      orderId,
      actorId: userId,
      paymentMethod: bundle.order.payment_method,
      paymentReference: bundle.order.payment_reference,
    });
    revalidatePath("/admin");
    revalidatePath("/admin/verify");
    revalidatePath(`/admin/orders/${orderId}`);
    if (r.deliveryError) return { ok: true, warning: `Tickets issued, but the email could not be sent: ${r.deliveryError}. Re-send it from the order page.` };
    if (!r.emailed) return { ok: true, warning: "Tickets issued. No email on file, so nothing was sent." };
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function rejectOrder(orderId: string, reason: string): Promise<ActionResult> {
  try {
    const { userId } = await assertStaff("staff");
    const r = reason.trim();
    if (r.length < 3) return { ok: false, error: "Give a short reason for the buyer" };
    const admin = createAdminClient();
    const { error } = await admin
      .from("orders")
      .update({ status: "rejected", rejection_reason: r, verified_by: userId, verified_at: new Date().toISOString() })
      .eq("id", orderId)
      .in("status", ["awaiting_verification", "pending_payment"]);
    if (error) return { ok: false, error: error.message };
    await admin.from("audit_log").insert({ actor: userId, action: "order.rejected", entity: "order", entity_id: orderId, data: { reason: r } });
    const bundle = await getOrderBundle(orderId);
    if (bundle) await sendRejectionEmail(bundle, r).catch((e) => console.error(e));
    revalidatePath("/admin/verify");
    revalidatePath(`/admin/orders/${orderId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function resendTickets(orderId: string): Promise<ActionResult> {
  try {
    const { userId } = await assertStaff("staff");
    const r = await deliverOrder(orderId);
    await audit(createAdminClient(), { actor: userId, action: "order.resent", entity: "order", entity_id: orderId, data: { emailed: r.emailed, to: r.bundle.order.buyer_email } });
    revalidatePath(`/admin/orders/${orderId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/* ------------------------------------------------------------ cut-off */
/**
 * Set or clear the online sales cut-off of one ticket type. Admin only. Null
 * reopens sales with no end; a past instant closes them immediately. Takes
 * effect on the next page load, no deploy needed.
 */
export async function setSalesCutoff(ticketTypeId: string, closeAtIso: string | null): Promise<ActionResult> {
  try {
    const { userId } = await assertStaff("admin");
    z.string().uuid().parse(ticketTypeId);
    if (closeAtIso !== null && Number.isNaN(new Date(closeAtIso).getTime())) return { ok: false, error: "Invalid date" };
    const admin = createAdminClient();
    const { data: tt, error } = await admin.from("ticket_types").update({ sales_close_at: closeAtIso }).eq("id", ticketTypeId).select("name, code").single();
    if (error) return { ok: false, error: error.message };
    await audit(admin, { actor: userId, action: "ticket_type.cutoff", entity: "ticket_type", entity_id: ticketTypeId, data: { name: tt.name, code: tt.code, sales_close_at: closeAtIso } });
    revalidatePath("/");
    revalidatePath("/admin");
    revalidatePath("/admin/settings");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/* ------------------------------------------------------------------ void */
/**
 * Void one issued ticket (wrong approval, duplicate payment, buyer request).
 * Admin only. The wristband number stays with the voided ticket and is marked
 * void in the pool; the buyer is emailed. Reversible with unvoidTicket.
 */
export async function voidTicket(ticketId: string, reason: string): Promise<ActionResult> {
  try {
    const { userId } = await assertStaff("admin");
    const r = reason.trim();
    if (r.length < 3) return { ok: false, error: "Give a short reason (the buyer will see it)" };
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("void_ticket", { p_ticket_id: ticketId, p_actor: userId, p_reason: r });
    if (error) return { ok: false, error: error.message };
    const orderId = (data as { order_id: string } | null)?.order_id;
    if (!orderId) return { ok: true };
    const bundle = await getOrderBundle(orderId);
    let warning: string | undefined;
    if (bundle) {
      const voided = bundle.tickets.filter((t) => t.id === ticketId);
      const sent = await sendVoidEmail(bundle, voided, r).catch((e) => { console.error(e); return { ok: false as const }; });
      if (!sent.ok) warning = bundle.order.buyer_email ? "Ticket voided, but the notice email could not be sent." : "Ticket voided. No email on order, so the buyer was not notified.";
    }
    revalidatePath("/admin");
    revalidatePath(`/admin/orders/${orderId}`);
    return warning ? { ok: true, warning } : { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Undo a void: ticket becomes valid again and the fresh PDF is re-sent to the buyer. */
export async function unvoidTicket(ticketId: string): Promise<ActionResult> {
  try {
    const { userId } = await assertStaff("admin");
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("unvoid_ticket", { p_ticket_id: ticketId, p_actor: userId });
    if (error) return { ok: false, error: error.message };
    const orderId = (data as { order_id: string } | null)?.order_id;
    if (!orderId) return { ok: true };
    let warning: string | undefined;
    try {
      const r = await deliverOrder(orderId);
      if (!r.emailed) warning = "Ticket restored. No email on order, so nothing was sent.";
    } catch (e) {
      warning = `Ticket restored, but the ticket email could not be re-sent: ${e instanceof Error ? e.message : "error"}`;
    }
    revalidatePath("/admin");
    revalidatePath(`/admin/orders/${orderId}`);
    return warning ? { ok: true, warning } : { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Void every unused ticket of a paid order; tickets already scanned are skipped. */
export async function voidOrder(orderId: string, reason: string): Promise<ActionResult> {
  try {
    const { userId } = await assertStaff("admin");
    const r = reason.trim();
    if (r.length < 3) return { ok: false, error: "Give a short reason (the buyer will see it)" };
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("void_order", { p_order_id: orderId, p_actor: userId, p_reason: r });
    if (error) return { ok: false, error: error.message };
    const n = Number(data ?? 0);
    const bundle = await getOrderBundle(orderId);
    let warning: string | undefined;
    if (bundle && n > 0) {
      const voided = bundle.tickets.filter((t) => t.status === "void");
      const sent = await sendVoidEmail(bundle, voided, r).catch((e) => { console.error(e); return { ok: false as const }; });
      if (!sent.ok) warning = bundle.order.buyer_email ? `${n} ticket(s) voided, but the notice email could not be sent.` : `${n} ticket(s) voided. No email on order, so the buyer was not notified.`;
    }
    if (n === 0) warning = "Nothing to void: every ticket in this order was already scanned or void.";
    revalidatePath("/admin");
    revalidatePath(`/admin/orders/${orderId}`);
    return warning ? { ok: true, warning } : { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/* ------------------------------------------------------- conversion */
export interface ConvertTarget {
  id: string;
  code: string;
  name: string;
  band_color: string | null;
  price_centavos: number;
  includes_shirt: boolean;
  /** How many of this label a buyer could still be given. */
  sellable: number;
}

/**
 * Ticket types a paid order can be swapped into. Three are excluded: VIP Car
 * Display needs a plate number and a car photo this form cannot collect, the
 * gate-only labels have no online price (they are tallied, not ordered), and the
 * drifter label is handed out on its own tab.
 */
export async function getConvertTargets(orderId: string): Promise<ConvertTarget[]> {
  await assertStaff("admin");
  const admin = createAdminClient();
  const { data: order } = await admin.from("orders").select("event_id").eq("id", orderId).maybeSingle();
  if (!order) return [];
  const { data: types } = await admin
    .from("ticket_types")
    .select("id, code, name, band_color, price_centavos, includes_shirt, requires_vehicle, drifter_family, sell_online")
    .eq("event_id", order.event_id)
    .eq("active", true)
    .order("sort_order");
  const { data: avail } = await admin
    .from("v_ticket_type_availability")
    .select("ticket_type_id, sellable")
    .eq("event_id", order.event_id);
  const left = new Map((avail ?? []).map((a) => [a.ticket_type_id as string, Number(a.sellable)]));
  return ((types ?? []) as (Pick<TicketTypeRow, "id" | "code" | "name" | "band_color" | "price_centavos" | "includes_shirt" | "requires_vehicle" | "drifter_family" | "sell_online">)[])
    .filter((t) => t.sell_online && !t.requires_vehicle && !t.drifter_family)
    .map((t) => ({
      id: t.id, code: t.code, name: t.name, band_color: t.band_color,
      price_centavos: t.price_centavos, includes_shirt: t.includes_shirt,
      sellable: left.get(t.id) ?? 0,
    }));
}

const convertSchema = z.object({
  orderId: z.string().uuid(),
  ticketTypeId: z.string().uuid(),
  qty: z.number().int().min(1).max(50),
  reason: z.string().trim().min(3, "Give a short reason (the buyer will see it)").max(200),
  attendees: z.array(z.object({
    holder_name: z.string().trim().max(80).optional(),
    shirt_size: z.string().trim().max(10).optional(),
  })).max(50).optional(),
});

/**
 * Swap a paid order to a different ticket type, keeping its order number, receipt
 * and payment trail. The old bands go back to the pool, new ones are issued, and
 * the price difference is left on the order as a balance to settle by hand.
 */
export async function convertOrder(input: z.input<typeof convertSchema>): Promise<ActionResult & { summary?: string }> {
  try {
    const { userId } = await assertStaff("admin");
    const p = convertSchema.parse(input);

    // Captured before the swap: the email has to name the numbers that stopped working.
    const before = await getOrderBundle(p.orderId);
    if (!before) return { ok: false, error: "Order not found" };
    const from = before.tickets
      .filter((t) => t.status === "issued")
      .map((t) => ({ number: t.number, type: t.ticket_type.name }));

    const admin = createAdminClient();
    const { data, error } = await admin.rpc("convert_order", {
      p_order_id: p.orderId,
      p_target_type_id: p.ticketTypeId,
      p_qty: p.qty,
      p_attendees: p.attendees ?? [],
      p_actor: userId,
      p_reason: p.reason,
      p_tokens: Array.from({ length: p.qty }, newQrToken),
    });
    if (error) return { ok: false, error: error.message };

    const r = data as { type: string; qty: number; old_total_centavos: number; new_total_centavos: number; balance_centavos: number };
    const money = r.balance_centavos > 0
      ? `Refund ${(r.balance_centavos / 100).toFixed(2)} to the buyer.`
      : r.balance_centavos < 0
        ? `Collect ${(-r.balance_centavos / 100).toFixed(2)} more from the buyer.`
        : "Nothing to settle.";

    // A delivery problem must not look like a failed conversion: the swap is committed.
    let warning: string | undefined;
    try {
      const sent = await deliverConversion(p.orderId, { from, reason: p.reason, balanceCentavos: r.balance_centavos });
      if (!sent.emailed) warning = `Converted to ${r.qty} x ${r.type}. ${money} No email was sent (no address on the order).`;
    } catch (e) {
      console.error(`[convert] delivery failed for order ${p.orderId}:`, e);
      warning = `Converted to ${r.qty} x ${r.type}. ${money} The new ticket email could not be sent - use "Re-send ticket email".`;
    }

    revalidatePath("/admin");
    revalidatePath("/admin/orders");
    revalidatePath(`/admin/orders/${p.orderId}`);
    return warning ? { ok: true, warning } : { ok: true, summary: `Converted to ${r.qty} x ${r.type}. ${money}` };
  } catch (e) {
    return fail(e);
  }
}

/** Record that the refund (or the extra payment) has actually been moved. */
export async function settleOrderBalance(orderId: string, note: string): Promise<ActionResult> {
  try {
    const { userId } = await assertStaff("admin");
    const id = z.string().uuid().parse(orderId);
    const admin = createAdminClient();
    const { error } = await admin.rpc("settle_order_balance", { p_order_id: id, p_actor: userId, p_note: note.trim().slice(0, 200) });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/admin");
    revalidatePath("/admin/orders");
    revalidatePath(`/admin/orders/${id}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/* ------------------------------------------------------- order detail */
/**
 * Everything the Orders page shows when a row is expanded. Fetched on demand, one
 * order at a time, so opening the list costs nothing extra.
 */
export interface OrderDetail {
  id: string;
  order_no: number;
  status: OrderStatus;
  channel: string;
  buyer_name: string;
  buyer_email: string | null;
  buyer_mobile: string | null;
  payment_method: string | null;
  payment_reference: string | null;
  payment_proof_path: string | null;
  proof_submitted_at: string | null;
  paid_at: string | null;
  email_sent_at: string | null;
  receipt_no: number | null;
  rejection_reason: string | null;
  created_at: string;
  total_centavos: number;
  /** After a conversion: positive = refund owed to the buyer, negative = the buyer owes. */
  balance_centavos: number;
  balance_settled_at: string | null;
  balance_note: string | null;
  items: { id: string; label: string; amount_centavos: number }[];
  tickets: {
    id: string; number: string; type: string; holder_name: string | null; shirt_size: string | null;
    vehicle: string | null; vehicle_photo_path: string | null; companion_of: string | null; included: boolean;
    status: TicketStatus; redeemed_at: string | null; void_reason: string | null; qr_token: string;
    /** Voided by a conversion: the band went back to the pool, so it cannot be restored. */
    converted: boolean;
  }[];
}

export async function getOrderDetail(orderId: string): Promise<OrderDetail | null> {
  await assertStaff("staff");
  const b = await getOrderBundle(orderId);
  if (!b) return null;
  const { order, items, tickets } = b;
  return {
    id: order.id,
    order_no: order.order_no,
    status: order.status,
    channel: order.channel,
    buyer_name: order.buyer_name,
    buyer_email: order.buyer_email,
    buyer_mobile: order.buyer_mobile,
    payment_method: order.payment_method,
    payment_reference: order.payment_reference,
    payment_proof_path: order.payment_proof_path,
    proof_submitted_at: order.proof_submitted_at,
    paid_at: order.paid_at,
    email_sent_at: order.email_sent_at,
    receipt_no: order.receipt_no,
    rejection_reason: order.rejection_reason,
    created_at: order.created_at,
    total_centavos: order.total_centavos,
    balance_centavos: order.balance_centavos,
    balance_settled_at: order.balance_settled_at,
    balance_note: order.balance_note,
    items: items.map((it) => ({ id: it.id, label: itemLabel(it), amount_centavos: it.qty * it.unit_price_centavos })),
    tickets: tickets.map((t) => ({
      id: t.id,
      number: t.number,
      type: t.ticket_type.name,
      holder_name: t.holder_name,
      shirt_size: t.shirt_size,
      vehicle: t.vehicle_plate ? `${t.vehicle_plate} ${t.vehicle_model ?? ""}`.trim() : null,
      vehicle_photo_path: t.vehicle_photo_path,
      companion_of: t.companion_of,
      included: t.included,
      status: t.status,
      redeemed_at: t.redeemed_at,
      void_reason: t.void_reason,
      qr_token: t.qr_token,
      converted: t.ticket_number_id === null,
    })),
  };
}

export type PrivateBucket = "payment-proofs" | "vehicle-photos";

/** Short-lived signed URL for an object in one of the private buckets. Any signed-in staff. */
export async function getSignedUrl(bucket: PrivateBucket, path: string): Promise<string | null> {
  await assertStaff("scanner");
  if (bucket !== "payment-proofs" && bucket !== "vehicle-photos") return null;
  const admin = createAdminClient();
  const { data } = await admin.storage.from(bucket).createSignedUrl(path, 60 * 10);
  return data?.signedUrl ?? null;
}

/** Signed URL for a payment screenshot (private bucket). */
export async function getProofUrl(path: string): Promise<string | null> {
  return getSignedUrl("payment-proofs", path);
}

/* ------------------------------------------------------------ number pool */
const rangeSchema = z.object({
  ticket_type_id: z.string().uuid(),
  prefix: z.string().trim().max(10),
  start: z.coerce.number().int().min(0),
  end: z.coerce.number().int().min(0),
  pad: z.coerce.number().int().min(0).max(8),
});

export async function importNumberRange(formData: FormData): Promise<ActionResult & { inserted?: number }> {
  try {
    const { userId } = await assertStaff("admin");
    const parsed = rangeSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
    const { start, end } = parsed.data;
    if (end < start) return { ok: false, error: "End must be greater than or equal to start" };
    if (end - start > 20000) return { ok: false, error: "Import at most 20,000 numbers at a time" };
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("import_number_range", {
      p_ticket_type_id: parsed.data.ticket_type_id,
      p_prefix: parsed.data.prefix,
      p_start: start,
      p_end: end,
      p_pad: parsed.data.pad,
    });
    if (error) return { ok: false, error: error.message };
    await admin.from("audit_log").insert({ actor: userId, action: "numbers.imported", entity: "ticket_type", entity_id: parsed.data.ticket_type_id, data: parsed.data });
    revalidatePath("/admin/numbers");
    return { ok: true, inserted: data ?? 0 };
  } catch (e) {
    return fail(e);
  }
}

/** Import an explicit list of numbers (one per line) for non-sequential serials. */
export async function importNumberList(formData: FormData): Promise<ActionResult & { inserted?: number }> {
  try {
    const { userId } = await assertStaff("admin");
    const ticketTypeId = z.string().uuid().parse(formData.get("ticket_type_id"));
    const raw = String(formData.get("numbers") ?? "");
    const numbers = Array.from(new Set(raw.split(/\r?\n|,/).map((s) => s.trim()).filter(Boolean)));
    if (numbers.length === 0) return { ok: false, error: "Paste at least one number" };
    if (numbers.length > 20000) return { ok: false, error: "Import at most 20,000 numbers at a time" };
    const admin = createAdminClient();
    const { data: maxRow } = await admin
      .from("ticket_numbers")
      .select("seq")
      .eq("ticket_type_id", ticketTypeId)
      .order("seq", { ascending: false })
      .limit(1)
      .maybeSingle();
    let seq = (maxRow?.seq ?? 0) + 1;
    const rows = numbers.map((number) => ({ ticket_type_id: ticketTypeId, number, seq: seq++ }));
    const { error, count } = await admin.from("ticket_numbers").upsert(rows, { onConflict: "ticket_type_id,number", ignoreDuplicates: true, count: "exact" });
    if (error) return { ok: false, error: error.message };
    await admin.from("audit_log").insert({ actor: userId, action: "numbers.imported_list", entity: "ticket_type", entity_id: ticketTypeId, data: { count: numbers.length } });
    revalidatePath("/admin/numbers");
    return { ok: true, inserted: count ?? numbers.length };
  } catch (e) {
    return fail(e);
  }
}

export async function voidNumber(numberId: string, reason: string): Promise<ActionResult> {
  try {
    const { userId } = await assertStaff("admin");
    const admin = createAdminClient();
    const { error } = await admin
      .from("ticket_numbers")
      .update({ status: "void", void_reason: reason.trim() || "voided" })
      .eq("id", numberId)
      .eq("status", "available");
    if (error) return { ok: false, error: error.message };
    await admin.from("audit_log").insert({ actor: userId, action: "number.voided", entity: "ticket_number", entity_id: numberId, data: { reason } });
    revalidatePath("/admin/numbers");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Put a voided wristband number back into the pool. Only void -> available is
 * allowed; numbers already assigned to a ticket are untouched. The old void
 * reason is kept in the audit trail so the history stays explainable.
 */
export async function unvoidNumber(numberId: string): Promise<ActionResult> {
  try {
    const { userId } = await assertStaff("admin");
    const admin = createAdminClient();
    const { data: row, error: readErr } = await admin.from("ticket_numbers").select("number, status, void_reason").eq("id", numberId).maybeSingle();
    if (readErr) return { ok: false, error: readErr.message };
    if (!row) return { ok: false, error: "Number not found" };
    if (row.status !== "void") return { ok: false, error: `${row.number} is ${row.status}, not void` };
    const { error } = await admin
      .from("ticket_numbers")
      .update({ status: "available", void_reason: null })
      .eq("id", numberId)
      .eq("status", "void");
    if (error) return { ok: false, error: error.message };
    await admin.from("audit_log").insert({ actor: userId, action: "number.unvoided", entity: "ticket_number", entity_id: numberId, data: { number: row.number, previous_reason: row.void_reason } });
    revalidatePath("/admin/numbers");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
