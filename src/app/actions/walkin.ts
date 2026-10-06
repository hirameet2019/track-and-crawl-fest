"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRules } from "@/lib/rules";
import type { PaymentMethod } from "@/lib/supabase/types";
import type { ActionResult } from "./orders";

function fail(e: unknown): ActionResult {
  return { ok: false, error: e instanceof Error ? e.message : "Something went wrong" };
}

const methodSchema = z.enum(["cash", "gotyme", "gcash", "maya"]);

export interface RecordWalkinInput {
  ticketTypeId: string;
  delta: number;
  method: PaymentMethod;
  shirtSize?: string | null;
  holderName?: string | null;
  vehiclePlate?: string | null;
  /** A fresh id per sale from the device; send the same one again on a retry. */
  clientRef?: string | null;
  /** GCash, Maya and GoTyme sales: the transfer's reference number. */
  paymentRef?: string | null;
}

/**
 * Walk-in tally: +N sales at the gate (or -N to correct a mistake). A sale is one
 * band, or for a label with included passengers one car with all its bands. A label
 * that includes a shirt needs the size handed over, a label with gate_needs_name the
 * person's name, and a car label the plate too. A retry with the same clientRef
 * records nothing new. No tickets, no email.
 */
export async function recordWalkin(input: RecordWalkinInput): Promise<ActionResult & { count?: number; saleId?: string; duplicate?: boolean }> {
  try {
    const { userId } = await assertStaff("gate");
    const ticketTypeId = z.string().uuid().parse(input.ticketTypeId);
    const delta = z.number().int().min(-50).max(50).parse(input.delta);
    if (delta === 0) return { ok: false, error: "Nothing to record" };
    const method = methodSchema.parse(input.method);
    const sizes = (await getRules()).shirtChart.map((r) => r.size);
    const shirtSize = input.shirtSize ? z.string().refine((v) => sizes.includes(v), "That shirt size is not offered").parse(input.shirtSize) : null;
    const holderName = z.string().trim().max(80).optional().nullable().parse(input.holderName) || null;
    const vehiclePlate = z.string().trim().max(20).optional().nullable().parse(input.vehiclePlate) || null;
    const clientRef = input.clientRef ? z.string().uuid().parse(input.clientRef) : null;
    const paymentRef = z.string().trim().max(60).optional().nullable().parse(input.paymentRef) || null;
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("record_walkin", {
      p_ticket_type_id: ticketTypeId, p_qty: delta, p_actor: userId, p_method: method, p_shirt_size: shirtSize,
      p_holder_name: holderName, p_vehicle_plate: vehiclePlate, p_client_ref: clientRef, p_payment_ref: paymentRef,
    });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/admin");
    revalidatePath("/admin/walkin");
    const d = data as { count: number; sale_id: string; duplicate: boolean } | null;
    return { ok: true, count: Number(d?.count ?? 0), saleId: d?.sale_id, duplicate: !!d?.duplicate };
  } catch (e) {
    return fail(e);
  }
}

/** Reverse exactly one gate sale, once, shortly after it was made (seller or admin). */
export async function undoWalkinSale(saleId: string): Promise<ActionResult> {
  try {
    const { userId } = await assertStaff("gate");
    const id = z.string().uuid().parse(saleId);
    const { error } = await createAdminClient().rpc("undo_walkin_sale", { p_actor: userId, p_sale_id: id });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/admin");
    revalidatePath("/admin/walkin");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Admin sets the gate price for a label (in pesos). Online price is untouched. */
export async function setWalkinPrice(ticketTypeId: string, pesos: number): Promise<ActionResult> {
  try {
    const { userId } = await assertStaff("admin");
    const id = z.string().uuid().parse(ticketTypeId);
    const amount = z.number().min(0).max(100000).parse(pesos);
    const centavos = Math.round(amount * 100);
    const admin = createAdminClient();
    const { error } = await admin.from("ticket_types").update({ walkin_price_centavos: centavos }).eq("id", id);
    if (error) return { ok: false, error: error.message };
    await admin.from("audit_log").insert({ actor: userId, action: "ticket_type.walkin_price", entity: "ticket_type", entity_id: id, data: { walkin_price_centavos: centavos } });
    revalidatePath("/admin");
    revalidatePath("/admin/walkin");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
