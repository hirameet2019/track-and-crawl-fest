"use server";

import { assertScan } from "@/lib/auth";
import { shirtShips } from "@/lib/shipping";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TicketRow, TicketTypeRow } from "@/lib/supabase/types";

export interface ScanTicket {
  id: string;
  number: string;
  status: TicketRow["status"];
  holder_name: string | null;
  shirt_size: string | null;
  included: boolean;
  vehicle_plate: string | null;
  vehicle_model: string | null;
  /** Signed URL (10 min) of the car photo, VIP Car Display only. */
  vehicle_photo_url?: string | null;
  /** Plate of the car this companion ticket rides with. */
  companion_of: string | null;
  redeemed_at: string | null;
  kit_claimed: Record<string, boolean>;
  ticket_type: Pick<
    TicketTypeRow,
    "name" | "code" | "band_color" | "includes_shirt" | "includes_lanyard" | "includes_sticker" | "includes_car_pass"
  >;
  order: { order_no: number; buyer_name: string; buyer_mobile: string | null };
  /** The shirt ships to the buyer: nothing to hand over at the gate. */
  shirt_ships: boolean;
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
      "id, number, status, holder_name, shirt_size, vehicle_plate, vehicle_model, vehicle_photo_path, companion_of, included, redeemed_at, kit_claimed, ticket_type:ticket_types(name, code, band_color, includes_shirt, includes_lanyard, includes_sticker, includes_car_pass, ships_shirt), order:orders(order_no, buyer_name, buyer_mobile, shipping)",
    )
    .eq("id", ticketId)
    .maybeSingle();
  if (!data) return null;
  const row = data as unknown as ScanTicket & {
    vehicle_photo_path: string | null;
    ticket_type: ScanTicket["ticket_type"] & { ships_shirt?: boolean };
    order: ScanTicket["order"] & { shipping?: unknown };
  };
  // The gate only needs to know the shirt is not theirs to hand over, not the address.
  row.shirt_ships = shirtShips(row.ticket_type, row.order);
  delete row.order.shipping;
  if (row.vehicle_photo_path) {
    const { data: signed } = await admin.storage.from("vehicle-photos").createSignedUrl(row.vehicle_photo_path, 60 * 10);
    row.vehicle_photo_url = signed?.signedUrl ?? null;
  }
  return row;
}

/** Look up without redeeming (for a confirm step). */
export async function lookupTicket(raw: string): Promise<ScanResult> {
  try {
    await assertScan();
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
    const { userId } = await assertScan();
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
  const { userId } = await assertScan();
  const admin = createAdminClient();
  const { data } = await admin.from("tickets").select("kit_claimed").eq("id", ticketId).single();
  const next = { ...(data?.kit_claimed ?? {}), [item]: claimed };
  await admin.from("tickets").update({ kit_claimed: next }).eq("id", ticketId);
  await admin.from("audit_log").insert({ actor: userId, action: "ticket.kit", entity: "ticket", entity_id: ticketId, data: { item, claimed } });
  return next;
}

export interface TicketMatch {
  token: string;
  number: string;
  type: string;
  holder: string | null;
  status: TicketRow["status"];
  order_no: number;
  buyer_name: string;
}

/**
 * Fallback for a QR that cannot be read: find tickets by wristband number, by
 * the holder's name or by the buyer's name. A torn print, a dead phone or a
 * camera that will not focus is then no longer a dead end, because the number
 * is printed large on the ticket and stamped on the physical band.
 *
 * Deliberately uses separate ilike() calls instead of one or() filter: commas
 * and parentheses are PostgREST filter syntax, so user text does not belong in
 * an or() string.
 */
export async function findTickets(query: string): Promise<TicketMatch[]> {
  await assertScan();
  // Strip the LIKE wildcards so a typed % or _ matches literally, not everything.
  const q = query.trim().replace(/[%_]/g, "");
  if (q.length < 2) return [];
  const admin = createAdminClient();
  const cols =
    "id, qr_token, number, status, holder_name, ticket_type:ticket_types(name), order:orders(order_no, buyer_name)";

  const byOrderIds = await admin.from("orders").select("id").ilike("buyer_name", `%${q}%`).limit(20);
  const orderIds = (byOrderIds.data ?? []).map((o) => o.id);

  const [byNumber, byHolder, byBuyer] = await Promise.all([
    admin.from("tickets").select(cols).ilike("number", `%${q}%`).limit(20),
    admin.from("tickets").select(cols).ilike("holder_name", `%${q}%`).limit(20),
    orderIds.length ? admin.from("tickets").select(cols).in("order_id", orderIds).limit(20) : Promise.resolve({ data: [] }),
  ]);

  type Row = {
    id: string;
    qr_token: string;
    number: string;
    status: TicketRow["status"];
    holder_name: string | null;
    ticket_type: { name: string } | null;
    order: { order_no: number; buyer_name: string } | null;
  };
  const seen = new Map<string, TicketMatch>();
  for (const row of [...(byNumber.data ?? []), ...(byHolder.data ?? []), ...(byBuyer.data ?? [])] as unknown as Row[]) {
    if (seen.has(row.id)) continue;
    seen.set(row.id, {
      token: row.qr_token,
      number: row.number,
      type: row.ticket_type?.name ?? "",
      holder: row.holder_name,
      status: row.status,
      order_no: row.order?.order_no ?? 0,
      buyer_name: row.order?.buyer_name ?? "",
    });
  }
  // Unused bands first: at a gate the staff almost always wants the one that can still be admitted.
  return [...seen.values()]
    .sort((a, b) => (a.status === b.status ? a.number.localeCompare(b.number) : a.status === "issued" ? -1 : 1))
    .slice(0, 12);
}

/** Offline support: the scanner page caches this list and validates locally when the network is down. */
export async function downloadTicketCache(): Promise<{ token: string; number: string; type: string; holder: string | null; status: string }[]> {
  await assertScan();
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
