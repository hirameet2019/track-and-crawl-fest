"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PaymentMethod } from "@/lib/supabase/types";
import type { ActionResult } from "./orders";

function fail(e: unknown): ActionResult {
  return { ok: false, error: e instanceof Error ? e.message : "Something went wrong" };
}

const methodSchema = z.enum(["cash", "gotyme", "gcash", "maya"]);

export interface DrifterResult {
  drifter_name: string;
  team_name: string | null;
  /** The drifter's running band total after this entry. */
  total: number;
  /** Bands in this entry that fell inside the free allowance. */
  free: number;
  paid: number;
  charge_centavos: number;
}

/**
 * Hand wristbands to a competing drifter's team (or -N to take them back).
 * The first `free_allowance` bands per drifter are free; the rest are charged at
 * the label's gate price. Splitting is done in SQL so two staff tapping at once
 * cannot both claim the same free band, and so is the rules confirmation: SQL
 * refuses a hand-out without it, whatever the form does.
 */
export async function recordDrifterBands(input: {
  ticketTypeId: string;
  drifterName: string;
  team?: string;
  delta: number;
  method: PaymentMethod;
  rulesAck: boolean;
  /** Staff confirm the money for bands past the free allowance was received. */
  paymentConfirmed?: boolean;
  /** Required by SQL for a GoTyme, GCash or Maya payment. */
  paymentRef?: string;
}): Promise<ActionResult & { result?: DrifterResult }> {
  try {
    const { userId } = await assertStaff("staff");
    const ticketTypeId = z.string().uuid().parse(input.ticketTypeId);
    const drifterName = z.string().trim().min(2, "Enter the drifter's name").max(80).parse(input.drifterName);
    const delta = z.number().int().min(-20).max(20).parse(input.delta);
    if (delta === 0) return { ok: false, error: "Nothing to record" };
    const method = methodSchema.parse(input.method);
    const team = z.string().trim().max(80).optional().parse(input.team);
    const rulesAck = z.boolean().parse(input.rulesAck);
    if (delta > 0 && !rulesAck) return { ok: false, error: "Tick the confirmation first: the drifter must understand the wristband rules." };

    const admin = createAdminClient();
    const { data, error } = await admin.rpc("record_drifter_bands", {
      p_ticket_type_id: ticketTypeId,
      p_drifter_name: drifterName,
      p_qty: delta,
      p_actor: userId,
      p_method: method,
      p_rules_ack: rulesAck,
      p_team: team || null,
      p_payment_confirmed: input.paymentConfirmed === true,
      p_payment_ref: z.string().trim().max(60).optional().parse(input.paymentRef) || null,
    });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/admin");
    revalidatePath("/admin/drifters");
    return { ok: true, result: data as DrifterResult };
  } catch (e) {
    return fail(e);
  }
}

/** Admin changes how many bands each drifter gets for free (organizer set 4). */
export async function setDrifterAllowance(ticketTypeId: string, bands: number): Promise<ActionResult> {
  try {
    const { userId } = await assertStaff("admin");
    const id = z.string().uuid().parse(ticketTypeId);
    const allowance = z.number().int().min(0).max(50).parse(bands);
    const admin = createAdminClient();
    const { error } = await admin.from("ticket_types").update({ free_allowance: allowance }).eq("id", id);
    if (error) return { ok: false, error: error.message };
    await admin.from("audit_log").insert({
      actor: userId, action: "ticket_type.free_allowance", entity: "ticket_type", entity_id: id,
      data: { free_allowance: allowance },
    });
    revalidatePath("/admin/drifters");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
