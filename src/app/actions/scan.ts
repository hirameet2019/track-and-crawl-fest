"use server";

import { assertStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TicketRow, TicketTypeRow } from "@/lib/supabase/types";

export interface ScanTicket {
  id: string;
  number: string;
  status: TicketRow["status"];
  holder_name: string | null;
  shirt_size: string | null;
  vehicle_plate: string | null;
  vehicle_model: string | null;
  /** Signed URL (10 min) of the car photo, VIP Car Display only. */
  vehicle_photo_url?: string | null;
  redeemed_at: string | null;
  kit_claimed: Record<string, boolean>;
  ticket_type: Pick<
    TicketTypeRow,
    "name" | "code" | "band_color" | "includes_shirt" | "includes_lanyard" | "includes_sticker" | "includes_car_pass"
  >;
  order: { order_no: number; buyer_name: string; buyer_mobile: string | null };
}

export type ScanResult =
  | { result: "ok" | "already_redeemed" | "void"; ticket: ScanTicket }
  | { result: "not_found" | "error"; message?: string };

/** Accepts a raw QR payload (full URL or bare token) and returns the token. */
function extractToken(raw: string): string {
  const s = raw.trim();
  const m = s.match(/\/t\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : s;
}

async function loadTicket(ticketId: string): Promise<ScanTicket | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("tickets")
    .select(
      "id, number, status, holder_name, shirt_size, vehicle_plate, vehicle_model, vehicle_photo_path, redeemed_at, kit_claimed, ticket_type:ticket_types(name, code, band_color, includes_shirt, includes_lanyard, includes_sticker, includes_car_pass), order:orders(order_no, buyer_name, buyer_mobile)",
    )
    .eq("id", ticketId)
    .maybeSingle();
  if (!data) return null;
  const row = data as unknown as ScanTicket & { vehicle_photo_path: string | null };
  if (row.vehicle_photo_path) {
    const { data: signed } = await admin.storage.from("vehicle-photos").createSignedUrl(row.vehicle_photo_path, 60 * 10);
    row.vehicle_photo_url = signed?.signedUrl ?? null;
  }
  return row;
}

/** Look up without redeeming (for a confirm step). */
export async function lookupTicket(raw: string): Promise<ScanResult> {
  try {
    await assertStaff("scanner");
    const admin = createAdminClient();
    const { data } = await admin.from("tickets").select("id, status").eq("qr_token", extractToken(raw)).maybeSingle();
    if (!data) return { result: "not_found" };
    const ticket = await loadTicket(data.id);
    if (!ticket) return { result: "not_found" };
    return { result: data.status === "issued" ? "ok" : data.status === "redeemed" ? "already_redeemed" : "void", ticket };
  } catch (e) {
    return { result: "error", message: e instanceof Error ? e.message : "error" };
  }
}

/** Redeem: marks the ticket used. Second scans return already_redeemed with the original time. */
export async function redeemTicket(raw: string): Promise<ScanResult> {
  try {
    const { userId } = await assertStaff("scanner");
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("redeem_ticket", { p_token: extractToken(raw), p_actor: userId });
    if (error) return { result: "error", message: error.message };
    const row = data?.[0];
    if (!row || row.result === "not_found" || !row.ticket_id) return { result: "not_found" };
    const ticket = await loadTicket(row.ticket_id);
    if (!ticket) return { result: "not_found" };
    return { result: row.result as "ok" | "already_redeemed" | "void", ticket };
  } catch (e) {
    return { result: "error", message: e instanceof Error ? e.message : "error" };
  }
}

/** Tick off kit items handed over (shirt, lanyard, sticker, car pass). */
export async function markKitClaimed(ticketId: string, item: string, claimed: boolean): Promise<Record<string, boolean>> {
  const { userId } = await assertStaff("scanner");
  const admin = createAdminClient();
  const { data } = await admin.from("tickets").select("kit_claimed").eq("id", ticketId).single();
  const next = { ...(data?.kit_claimed ?? {}), [item]: claimed };
  await admin.from("tickets").update({ kit_claimed: next }).eq("id", ticketId);
  await admin.from("audit_log").insert({ actor: userId, action: "ticket.kit", entity: "ticket", entity_id: ticketId, data: { item, claimed } });
  return next;
}

/** Offline support: the scanner page caches this list and validates locally when the network is down. */
export async function downloadTicketCache(): Promise<{ token: string; number: string; type: string; holder: string | null; status: string }[]> {
  await assertStaff("scanner");
  const admin = createAdminClient();
  const { data } = await admin
    .from("tickets")
    .select("qr_token, number, status, holder_name, ticket_type:ticket_types(name)")
    .limit(20000);
  return (data ?? []).map((t) => ({
    token: t.qr_token,
    number: t.number,
    status: t.status,
    holder: t.holder_name,
    type: (t.ticket_type as unknown as { name: string } | null)?.name ?? "",
  }));
}
