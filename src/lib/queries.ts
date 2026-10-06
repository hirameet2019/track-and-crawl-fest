import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  AvailabilityRow,
  EventRow,
  OrderItemRow,
  OrderRow,
  TicketRow,
  TicketTypeRow,
} from "@/lib/supabase/types";

export interface OrderBundle {
  order: OrderRow;
  event: EventRow;
  items: (OrderItemRow & { ticket_type: TicketTypeRow })[];
  tickets: (TicketRow & { ticket_type: TicketTypeRow })[];
}

/**
 * The single active event. The app currently supports one event at a time.
 * Wrapped in React's cache so the root layout's metadata, a page's metadata and
 * the page body share one query per request instead of each running their own.
 * Outside a render (server actions, route handlers) it simply runs the query.
 */
export const getActiveEvent = cache(async (): Promise<EventRow | null> => {
  const admin = createAdminClient();
  const { data } = await admin
    .from("events")
    .select("*")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
});

/**
 * Whether this event sells drifter family bands. The Drifters tab and its
 * dashboard shortcut only appear when it does, so an event without them (a
 * concert, say) does not show staff a tab that leads to "not set up".
 */
export const hasDrifterLabel = cache(async (eventId: string): Promise<boolean> => {
  const { count } = await createAdminClient()
    .from("ticket_types")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId)
    .eq("drifter_family", true);
  return (count ?? 0) > 0;
});

/**
 * Active ticket types in organizer order (B, Y, O, R, P, G).
 * `onlineOnly` hides walk-in-only labels from the public order form.
 */
export async function getTicketTypes(eventId: string, opts: { onlineOnly?: boolean } = {}): Promise<TicketTypeRow[]> {
  const admin = createAdminClient();
  let q = admin.from("ticket_types").select("*").eq("event_id", eventId).eq("active", true);
  if (opts.onlineOnly) q = q.eq("sell_online", true);
  const { data } = await q.order("sort_order");
  return data ?? [];
}

/** Order used on the public form: adult early bird, child, then the VIP tiers. */
export function publicOrder(types: TicketTypeRow[]): TicketTypeRow[] {
  const rank = (t: TicketTypeRow) => (t.requires_vehicle ? 3 : t.includes_shirt ? 2 : t.is_child ? 1 : 0);
  return [...types].sort((a, b) => rank(a) - rank(b) || a.sort_order - b.sort_order);
}

/**
 * What the public order form needs to know about stock: how many it may still
 * sell. Nothing else from the availability view (sold counts, revenue, scans)
 * may reach the browser, because the sales page is public and its props are
 * readable in the page source.
 */
export type PublicAvailability = Pick<AvailabilityRow, "ticket_type_id" | "sellable" | "pool_sellable" | "online_cap" | "cap_used">;

/** Trim availability to the stock fields, for the types on the public page only. */
export function publicAvailability(rows: AvailabilityRow[], types: Pick<TicketTypeRow, "id">[]): PublicAvailability[] {
  const onPage = new Set(types.map((t) => t.id));
  return rows
    .filter((r) => onPage.has(r.ticket_type_id))
    .map(({ ticket_type_id, sellable, pool_sellable, online_cap, cap_used }) => ({ ticket_type_id, sellable, pool_sellable, online_cap, cap_used }));
}

export async function getAvailability(eventId: string): Promise<AvailabilityRow[]> {
  const admin = createAdminClient();
  await admin.rpc("expire_stale_orders", {});
  const { data } = await admin
    .from("v_ticket_type_availability")
    .select("*")
    .eq("event_id", eventId)
    .order("sort_order");
  return data ?? [];
}

export async function getOrderBundle(orderId: string): Promise<OrderBundle | null> {
  const admin = createAdminClient();
  const { data: order } = await admin.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (!order) return null;
  const [{ data: event }, { data: items }, { data: tickets }] = await Promise.all([
    admin.from("events").select("*").eq("id", order.event_id).single(),
    admin
      .from("order_items")
      .select("*, ticket_type:ticket_types(*)")
      .eq("order_id", orderId),
    admin
      .from("tickets")
      .select("*, ticket_type:ticket_types(*)")
      .eq("order_id", orderId)
      .order("created_at")
      .order("number"),
  ]);
  if (!event) return null;
  return {
    order,
    event,
    items: (items ?? []) as OrderBundle["items"],
    tickets: (tickets ?? []) as OrderBundle["tickets"],
  };
}

export function isSalesOpen(event: EventRow, now = new Date()): boolean {
  if (event.sales_open_at && new Date(event.sales_open_at) > now) return false;
  if (event.sales_close_at && new Date(event.sales_close_at) < now) return false;
  return true;
}
