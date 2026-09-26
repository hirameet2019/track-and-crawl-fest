"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveEvent } from "@/lib/queries";
import { newDrifterToken } from "@/lib/tokens";
import { DRIFTER_ROLES, type PaymentMethod } from "@/lib/supabase/types";
import type { ActionResult } from "./orders";

function fail(e: unknown): ActionResult {
  return { ok: false, error: e instanceof Error ? e.message : "Something went wrong" };
}

const entrySchema = z.object({
  name: z.string().trim().min(2, "Every drifter needs a full name").max(80),
  team: z.string().trim().max(80).optional(),
  car: z.string().trim().max(20).optional(),
});

/**
 * Add drifters from the organizer's entry list, one or many at a time. Each gets
 * a private link. A name already on the list is skipped and reported rather than
 * duplicated, so the same drifter can never hold two links and two allowances.
 */
export async function addDrifterEntries(
  rows: z.input<typeof entrySchema>[],
): Promise<ActionResult & { added?: number; skipped?: string[] }> {
  try {
    const { userId } = await assertStaff("admin");
    const parsed = z.array(entrySchema).min(1, "Add at least one drifter").max(300).parse(rows);
    const event = await getActiveEvent();
    if (!event) return { ok: false, error: "No active event" };

    const admin = createAdminClient();
    const { data: type } = await admin
      .from("ticket_types")
      .select("id")
      .eq("event_id", event.id)
      .eq("drifter_family", true)
      .limit(1)
      .maybeSingle();
    if (!type) return { ok: false, error: "No drifter wristband label is set up for this event" };

    const { data: existing } = await admin
      .from("drifter_entries")
      .select("drifter_name")
      .eq("ticket_type_id", type.id)
      .eq("active", true);
    const taken = new Set((existing ?? []).map((e) => e.drifter_name.trim().toLowerCase()));

    const skipped: string[] = [];
    const fresh: typeof parsed = [];
    for (const r of parsed) {
      const key = r.name.replace(/\s+/g, " ").toLowerCase();
      if (taken.has(key)) { skipped.push(r.name); continue; }
      taken.add(key);
      fresh.push(r);
    }

    if (fresh.length > 0) {
      const { error } = await admin.from("drifter_entries").insert(
        fresh.map((r) => ({
          event_id: event.id,
          ticket_type_id: type.id,
          drifter_name: r.name.replace(/\s+/g, " "),
          team_name: r.team || null,
          car_no: r.car || null,
          token: newDrifterToken(),
          created_by: userId,
        })),
      );
      if (error) return { ok: false, error: error.message };
      await admin.from("audit_log").insert({
        actor: userId, action: "drifter.entry_added", entity: "drifter_entry", entity_id: type.id,
        data: { count: fresh.length, names: fresh.map((r) => r.name).slice(0, 50) },
      });
    }

    revalidatePath("/admin/drifters");
    return { ok: true, added: fresh.length, skipped };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Take a drifter off the list. Their link stops working straight away. Bands
 * already handed over stay handed over; this only closes the link.
 */
export async function removeDrifterEntry(entryId: string): Promise<ActionResult> {
  try {
    const { userId } = await assertStaff("admin");
    const id = z.string().uuid().parse(entryId);
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("drifter_entries")
      .update({ active: false })
      .eq("id", id)
      .select("drifter_name")
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    await admin.from("audit_log").insert({
      actor: userId, action: "drifter.entry_removed", entity: "drifter_entry", entity_id: id,
      data: { drifter: data?.drifter_name ?? null },
    });
    revalidatePath("/admin/drifters");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/**
 * The desk hands a pre-registered drifter their bands. Runs the ordinary tally,
 * so the free allowance, the price past it and the pool deduction all apply.
 */
export async function handOverDrifterEntry(
  entryId: string,
  method: PaymentMethod,
): Promise<ActionResult & { chargeCentavos?: number; bands?: number }> {
  try {
    const { userId } = await assertStaff("staff");
    const id = z.string().uuid().parse(entryId);
    const m = z.enum(["cash", "gotyme", "gcash", "maya"]).parse(method);
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("hand_over_drifter_entry", { p_entry_id: id, p_actor: userId, p_method: m });
    if (error) return { ok: false, error: error.message };
    const r = data as { total: number; charge_centavos: number } | null;
    revalidatePath("/admin");
    revalidatePath("/admin/drifters");
    return { ok: true, chargeCentavos: r?.charge_centavos ?? 0, bands: r?.total ?? 0 };
  } catch (e) {
    return fail(e);
  }
}

const personSchema = z.object({
  name: z.string().trim().min(2, "Every person needs a full name").max(80),
  role: z.enum(DRIFTER_ROLES),
});

/**
 * Public: a drifter submits their list through their private link. No login;
 * the token is the key, and SQL checks it, the rules confirmation and every name
 * again, so nothing the page sends can widen what the link allows.
 */
export async function submitDrifterRegistration(input: {
  token: string;
  people: { name: string; role: string }[];
  rulesAck: boolean;
}): Promise<ActionResult & { bandCount?: number }> {
  try {
    const token = z.string().trim().min(10).max(40).parse(input.token);
    const people = z.array(personSchema).min(1, "List at least one person").max(20).parse(input.people);
    if (!input.rulesAck) return { ok: false, error: "Please confirm that you understand the wristband rules." };

    const admin = createAdminClient();
    const { data, error } = await admin.rpc("submit_drifter_registration", {
      p_token: token,
      p_people: people,
      p_rules_ack: true,
    });
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/d/${token}`);
    revalidatePath("/admin/drifters");
    return { ok: true, bandCount: (data as { band_count: number } | null)?.band_count ?? people.length };
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Check the list and try again." };
    return fail(e);
  }
}

/**
 * Public: a drifter signs up through the organizer's shared link, typing their
 * own name, team and car number. Creates their entry and submits their list in
 * one step, then hands back their personal link for later changes.
 */
export async function selfRegisterDrifter(input: {
  slug: string;
  name: string;
  team?: string;
  car?: string;
  people: { name: string; role: string }[];
  rulesAck: boolean;
}): Promise<ActionResult & { token?: string; bandCount?: number }> {
  try {
    const slug = z.string().trim().min(10).max(40).parse(input.slug);
    const name = z.string().trim().min(2, "Enter your full name as the drifter").max(80).parse(input.name);
    const team = z.string().trim().max(80).optional().parse(input.team);
    const car = z.string().trim().max(20).optional().parse(input.car);
    const people = z.array(personSchema).min(1, "List at least one person").max(20).parse(input.people);
    if (!input.rulesAck) return { ok: false, error: "Please confirm that you understand the wristband rules." };

    const token = newDrifterToken();
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("self_register_drifter", {
      p_slug: slug,
      p_token: token,
      p_name: name,
      p_team: team || null,
      p_car: car || null,
      p_people: people,
      p_rules_ack: true,
    });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/admin/drifters");
    return { ok: true, token, bandCount: Number((data as { band_count: number } | null)?.band_count ?? people.length) };
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Check the form and try again." };
    return fail(e);
  }
}

/**
 * Admin: open, replace or close the shared sign-up link. Replacing gives a new
 * address and kills the old one at once - the fix when a link spreads too far.
 */
export async function setDrifterSignup(action: "open" | "replace" | "close"): Promise<ActionResult> {
  try {
    const { userId } = await assertStaff("admin");
    const a = z.enum(["open", "replace", "close"]).parse(action);
    const event = await getActiveEvent();
    if (!event) return { ok: false, error: "No active event" };
    const admin = createAdminClient();
    const { data: type } = await admin
      .from("ticket_types")
      .select("id, drifter_signup_slug")
      .eq("event_id", event.id)
      .eq("drifter_family", true)
      .limit(1)
      .maybeSingle();
    if (!type) return { ok: false, error: "No drifter wristband label is set up for this event" };

    const slug = a === "close" ? null : a === "open" && type.drifter_signup_slug ? type.drifter_signup_slug : newDrifterToken();
    const { error } = await admin.from("ticket_types").update({ drifter_signup_slug: slug }).eq("id", type.id);
    if (error) return { ok: false, error: error.message };
    await admin.from("audit_log").insert({
      actor: userId, action: "drifter.signup_link", entity: "ticket_type", entity_id: type.id, data: { action: a },
    });
    revalidatePath("/admin/drifters");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
