"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertStaff, assertSystem } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrderBundle } from "@/lib/queries";
import { audit } from "@/lib/audit";
import { issueOrder, deliverOrder, deliverConversion } from "@/lib/issue";
import { sendRejectionEmail, sendVoidEmail } from "@/lib/email";
import { carNameOf, itemLabel } from "@/lib/items";
import { shippingSchema, shirtShips, type Shipping } from "@/lib/shipping";
import { php } from "@/lib/money";
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
    const { userId } = await assertSystem();
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

/**
 * Undo a scan. Gate staff can scan the wrong band or the wrong person's phone,
 * and the real holder is then turned away with "already used" and no way back.
 * Admin only. The QR itself is unchanged and stays valid, so nothing is emailed.
 *
 * Unlike void/unvoid this is a guarded update rather than an RPC: it touches
 * three columns on one row and nothing else (no wristband pool, no order
 * status), and the status filter makes it atomic on its own.
 */
export async function unredeemTicket(ticketId: string, reason: string): Promise<ActionResult> {
  try {
    const { userId } = await assertStaff("admin");
    const r = reason.trim();
    if (r.length < 3) return { ok: false, error: "Give a short reason (it goes in the audit log)" };
    const admin = createAdminClient();

    const { data: before, error: readError } = await admin
      .from("tickets")
      .select("number, order_id, status, redeemed_at")
      .eq("id", ticketId)
      .maybeSingle();
    if (readError) return { ok: false, error: readError.message };
    if (!before) return { ok: false, error: "Ticket not found" };
    if (before.status !== "redeemed") {
      return { ok: false, error: `That ticket is "${before.status}", not scanned. There is nothing to undo.` };
    }

    const { data, error } = await admin
      .from("tickets")
      .update({ status: "issued", redeemed_at: null, redeemed_by: null })
      .eq("id", ticketId)
      .eq("status", "redeemed")
      .select("id")
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: "Someone changed this ticket just now. Refresh and try again." };

    await audit(admin, {
      actor: userId,
      action: "ticket.unredeemed",
      entity: "ticket",
      entity_id: ticketId,
      data: { number: before.number, reason: r, was_redeemed_at: before.redeemed_at },
    });
    revalidatePath("/admin");
    revalidatePath(`/admin/orders/${before.order_id}`);
    return { ok: true };
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
  /** The Drifters label: allowed here, but it sits outside that tab's free allowance. */
  drifter_family: boolean;
  /** Free bands each drifter gets on that label (only meaningful when drifter_family). */
  free_allowance: number;
  /** A car label: each ticket needs a plate (and model), like an online car order. */
  requires_vehicle: boolean;
  /** Free passengers issued with each car, from the same wristband stack. */
  included_companions: number;
  /** The shirt is shipped to the buyer, so the order needs a delivery address. */
  ships_shirt: boolean;
  /** Shares another label's wristband stack (VIP Pass (no shirt) uses the VIP Pass bands). */
  shares_stack_with: string | null;
}

/** A ticket of the order, so staff can pick which ones change. */
export interface ConvertTicket {
  id: string;
  number: string;
  code: string;
  type_name: string;
  holder_name: string | null;
  shirt_size: string | null;
  vehicle_plate: string | null;
  vehicle_model: string | null;
  /** What it was bought at: the price of its own order line (a free passenger is PHP 0). */
  price_centavos: number;
  /** Scanned at the gate: it stays as it is. */
  redeemed: boolean;
  /** A free passenger: the plate of the car it moves with. */
  passenger_of: string | null;
}

export interface ConvertContext {
  targets: ConvertTarget[];
  /** The order's delivery address, if it already has one. */
  shipping: Shipping | null;
  /** The order's live and scanned tickets, in issue order. */
  tickets: ConvertTicket[];
}

/**
 * Ticket types a paid order can be swapped into, and the order's delivery address.
 * Only labels without a ticket price are left out (the gate labels Y and O are
 * priced per tally and would collapse the order total to zero). Car labels are in:
 * the form collects each car's plate and model and its free passengers' names.
 * Drifter Family is priced, so it belongs here: the organizer asked for it so a
 * drifter's relative who bought an ordinary ticket can be moved onto the plain red band.
 */
export async function getConvertTargets(orderId: string): Promise<ConvertContext> {
  await assertStaff("admin");
  const admin = createAdminClient();
  const { data: order } = await admin.from("orders").select("event_id, shipping").eq("id", orderId).maybeSingle();
  if (!order) return { targets: [], shipping: null, tickets: [] };
  const { data: types } = await admin
    .from("ticket_types")
    .select("id, code, name, band_color, price_centavos, includes_shirt, requires_vehicle, drifter_family, free_allowance, included_companions, ships_shirt, pool_type_id")
    .eq("event_id", order.event_id)
    .eq("active", true)
    .order("sort_order");
  const { data: avail } = await admin
    .from("v_ticket_type_availability")
    .select("ticket_type_id, sellable, pool_sellable")
    .eq("event_id", order.event_id);
  const stock = new Map((avail ?? []).map((a) => [a.ticket_type_id as string, { sellable: Number(a.sellable), pool: Number(a.pool_sellable) }]));
  type Row = Pick<TicketTypeRow, "id" | "code" | "name" | "band_color" | "price_centavos" | "includes_shirt" | "requires_vehicle" | "drifter_family" | "free_allowance" | "included_companions" | "ships_shirt" | "pool_type_id">;
  const rows = (types ?? []) as Row[];
  const nameOf = new Map(rows.map((t) => [t.id, t.name]));
  const targets = rows
    .filter((t) => t.price_centavos > 0)
    .map((t) => {
      const s = stock.get(t.id) ?? { sellable: 0, pool: 0 };
      const passengers = t.requires_vehicle ? t.included_companions : 0;
      // A car also takes a band for each free passenger, from the same stack.
      const sellable = Math.max(0, Math.min(s.sellable, Math.floor(s.pool / (1 + passengers))));
      return {
        id: t.id, code: t.code, name: t.name, band_color: t.band_color,
        price_centavos: t.price_centavos, includes_shirt: t.includes_shirt,
        sellable, drifter_family: t.drifter_family, free_allowance: t.free_allowance,
        requires_vehicle: t.requires_vehicle, included_companions: passengers,
        ships_shirt: t.ships_shirt && t.includes_shirt,
        shares_stack_with: t.pool_type_id ? nameOf.get(t.pool_type_id) ?? null : null,
      };
    });

  // Each ticket is priced from its own line, the way the database does it: the free
  // passenger from the PHP 0 line, anything else from the priced line of its label.
  const [{ data: tks }, { data: lines }] = await Promise.all([
    admin
      .from("tickets")
      .select("id, number, status, holder_name, shirt_size, vehicle_plate, vehicle_model, companion_of, included, ticket_type_id, ticket_type:ticket_types(code, name)")
      .eq("order_id", orderId)
      .in("status", ["issued", "redeemed"])
      .order("created_at")
      .order("number"),
    admin.from("order_items").select("id, ticket_type_id, unit_price_centavos").eq("order_id", orderId),
  ]);
  type Line = { id: string; ticket_type_id: string; unit_price_centavos: number };
  const priceOf = (typeId: string, included: boolean) =>
    ((lines ?? []) as Line[])
      .filter((l) => l.ticket_type_id === typeId)
      .sort((a, b) =>
        Number((a.unit_price_centavos === 0) !== included) - Number((b.unit_price_centavos === 0) !== included)
        || b.unit_price_centavos - a.unit_price_centavos)[0]?.unit_price_centavos ?? 0;
  type Tk = {
    id: string; number: string; status: string; holder_name: string | null; shirt_size: string | null; vehicle_plate: string | null;
    vehicle_model: string | null; companion_of: string | null; included: boolean; ticket_type_id: string; ticket_type: { code: string; name: string } | null;
  };
  const tickets: ConvertTicket[] = ((tks ?? []) as unknown as Tk[]).map((t) => ({
    id: t.id, number: t.number, code: t.ticket_type?.code ?? "", type_name: t.ticket_type?.name ?? "",
    holder_name: t.holder_name, shirt_size: t.shirt_size, vehicle_plate: t.vehicle_plate, vehicle_model: t.vehicle_model,
    price_centavos: priceOf(t.ticket_type_id, t.included),
    redeemed: t.status === "redeemed",
    passenger_of: t.included ? t.companion_of : null,
  }));

  return { targets, shipping: (order.shipping as Shipping | null) ?? null, tickets };
}

const convertSchema = z.object({
  orderId: z.string().uuid(),
  ticketTypeId: z.string().uuid(),
  qty: z.number().int().min(1).max(50),
  reason: z.string().trim().min(3, "Give a short reason (the buyer will see it)").max(200),
  attendees: z.array(z.object({
    holder_name: z.string().trim().max(80).optional(),
    shirt_size: z.string().trim().max(10).optional(),
    vehicle_plate: z.string().trim().max(20).optional(),
    vehicle_model: z.string().trim().max(60).optional(),
    passengers: z.array(z.string().trim().max(80)).max(12).optional(),
  })).max(50).optional(),
  shipping: shippingSchema.optional(),
  /** The tickets that change; left out, every live ticket of the order does. */
  ticketIds: z.array(z.string().uuid()).min(1, "Pick at least one ticket to change").max(100).optional(),
});

/**
 * Swap a paid order to a different ticket type, keeping its order number, receipt
 * and payment trail. The old bands go back to the pool, new ones are issued, and
 * the price difference is left on the order as a balance to settle by hand.
 */
export async function convertOrder(input: z.input<typeof convertSchema>): Promise<ActionResult & { summary?: string }> {
  try {
    const { userId } = await assertStaff("admin");
    const parsed = convertSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
    const p = parsed.data;

    // Captured before the swap: the email has to name the numbers that stopped working.
    const before = await getOrderBundle(p.orderId);
    if (!before) return { ok: false, error: "Order not found" };
    const from = before.tickets
      .filter((t) => t.status === "issued")
      .map((t) => ({ number: t.number, type: t.ticket_type.name }));

    const admin = createAdminClient();
    const { data: target } = await admin.from("ticket_types").select("requires_vehicle, included_companions, includes_shirt, ships_shirt").eq("id", p.ticketTypeId).maybeSingle();
    if (!target) return { ok: false, error: "Unknown ticket type" };
    const attendees = p.attendees ?? [];
    if (target.requires_vehicle) {
      for (let i = 0; i < p.qty; i++) {
        if (!attendees[i]?.vehicle_plate) return { ok: false, error: `Enter the plate number of car ${i + 1}` };
      }
    }
    // The shirt of these labels is made to order and shipped: the order needs an address.
    if (target.ships_shirt && target.includes_shirt && !p.shipping && !before.order.shipping) {
      return { ok: false, error: "Enter where the shirt ships: this ticket's shirt is delivered, not handed over at the gate" };
    }
    const bands = p.qty * (1 + (target.requires_vehicle ? target.included_companions : 0));
    const { data, error } = await admin.rpc("convert_order", {
      p_order_id: p.orderId,
      p_target_type_id: p.ticketTypeId,
      p_qty: p.qty,
      p_attendees: attendees,
      p_actor: userId,
      p_reason: p.reason,
      p_tokens: Array.from({ length: bands }, newQrToken),
      p_shipping: target.ships_shirt && target.includes_shirt && p.shipping ? p.shipping : null,
      p_ticket_ids: p.ticketIds ?? null,
    });
    if (error) return { ok: false, error: error.message };

    const r = data as {
      type: string; qty: number; passengers?: number; old_total_centavos: number; new_total_centavos: number; balance_centavos: number;
      /** The tickets that changed (a car brings its free passengers along). */
      from?: { number: string; type: string }[];
      /** Live tickets left as they were. */
      kept?: number;
    };
    const changed = r.from?.length ? r.from : from;
    const kept = r.kept ?? 0;
    const what = `Changed ${changed.length} ticket${changed.length === 1 ? "" : "s"} to ${r.qty} x ${r.type}${kept ? `; ${kept} kept as they were` : ""}.`;
    const money = r.balance_centavos > 0
      ? `Refund ${php(r.balance_centavos)} to the buyer.`
      : r.balance_centavos < 0
        ? `Collect ${php(-r.balance_centavos)} more from the buyer.`
        : "Nothing to settle.";

    // A delivery problem must not look like a failed conversion: the swap is committed.
    let warning: string | undefined;
    try {
      const sent = await deliverConversion(p.orderId, { from: changed, reason: p.reason, balanceCentavos: r.balance_centavos, kept });
      if (!sent.emailed) warning = `${what} ${money} No email was sent (no address on the order).`;
    } catch (e) {
      console.error(`[convert] delivery failed for order ${p.orderId}:`, e);
      warning = `${what} ${money} The new ticket email could not be sent - use "Re-send ticket email".`;
    }

    revalidatePath("/admin");
    revalidatePath("/admin/orders");
    revalidatePath(`/admin/orders/${p.orderId}`);
    return warning ? { ok: true, warning } : { ok: true, summary: `${what} ${money}` };
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
  /** Where the shirts ship; null when nothing in the order ships. */
  shipping: Shipping | null;
  tickets: {
    id: string; number: string; type: string; holder_name: string | null; shirt_size: string | null;
    /** This ticket's shirt is shipped rather than handed over at the gate. */
    ships: boolean;
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
    items: items.map((it) => ({ id: it.id, label: itemLabel(it, true, carNameOf(items)), amount_centavos: it.qty * it.unit_price_centavos })),
    shipping: order.shipping ?? null,
    tickets: tickets.map((t) => ({
      id: t.id,
      number: t.number,
      type: t.ticket_type.name,
      holder_name: t.holder_name,
      shirt_size: t.shirt_size,
      ships: !!t.shirt_size && shirtShips(t.ticket_type, order),
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
    const { userId } = await assertSystem();
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
    const { userId } = await assertSystem();
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
    const { userId } = await assertSystem();
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
    const { userId } = await assertSystem();
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
