"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { SHIRT_SIZES } from "@/config/event";
import type { PaymentMethod } from "@/lib/supabase/types";
import type { ActionResult } from "./orders";

function fail(e: unknown): ActionResult {
  return { ok: false, error: e instanceof Error ? e.message : "Something went wrong" };
}

const methodSchema = z.enum(["cash", "gotyme", "gcash", "maya"]);

/**
 * Walk-in tally: +N sales at the gate (or -N to correct a mistake). A sale is one
 * band, or for a label with included passengers one car with all its bands. A label
 * that includes a shirt needs the size handed over. No buyer details, no tickets,
 * no email. Returns the new running band count for the label.
 */
export async function recordWalkin(input: { ticketTypeId: string; delta: number; method: PaymentMethod; shirtSize?: string | null }): Promise<ActionResult & { count?: number }> {
  try {
    const { userId } = await assertStaff("gate");
    const ticketTypeId = z.string().uuid().parse(input.ticketTypeId);
    const delta = z.number().int().min(-50).max(50).parse(input.delta);
    if (delta === 0) return { ok: false, error: "Nothing to record" };
    const method = methodSchema.parse(input.method);
    const shirtSize = input.shirtSize ? z.enum(SHIRT_SIZES).parse(input.shirtSize) : null;
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("record_walkin", {
      p_ticket_type_id: ticketTypeId, p_qty: delta, p_actor: userId, p_method: method, p_shirt_size: shirtSize,
    });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/admin");
    revalidatePath("/admin/walkin");
    return { ok: true, count: data ?? 0 };
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
