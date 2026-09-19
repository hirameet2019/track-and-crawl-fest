"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrderBundle } from "@/lib/queries";
import { audit } from "@/lib/audit";
import { issueOrder, deliverOrder } from "@/lib/issue";
import { sendRejectionEmail, sendVoidEmail } from "@/lib/email";
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
