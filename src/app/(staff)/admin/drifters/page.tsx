import { requireStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveEvent, getAvailability, getTicketTypes } from "@/lib/queries";
import { DrifterBands, type DrifterEntry, type OrderBandRow } from "@/components/DrifterBands";
import type { DrifterBandRow, PaymentMethod } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

/**
 * Drifters tab: family wristbands for the competing drivers, kept apart from the
 * public gate tally so the organizer can see at a glance how many bands went to
 * the grid rather than to paying guests.
 */
export default async function DriftersPage() {
  const session = await requireStaff("staff");
  const event = await getActiveEvent();
  if (!event) return <p>No active event.</p>;

  const [types, availability] = await Promise.all([getTicketTypes(event.id), getAvailability(event.id)]);
  const type = types.find((t) => t.drifter_family);
  if (!type) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Drifters</h1>
        <p className="text-sm text-zinc-500">No drifter family label is set up for this event.</p>
      </div>
    );
  }

  const admin = createAdminClient();
  const [{ data: drifterRows }, { data: recentRows }, { data: orderTickets }, { data: orderLines }] = await Promise.all([
    admin.from("v_drifter_bands").select("*").eq("ticket_type_id", type.id).order("drifter_name"),
    admin
      .from("walkin_sales")
      .select("id, created_at, drifter_name, team_name, qty, free_qty, unit_price_centavos, payment_method, staff:staff(full_name)")
      .eq("ticket_type_id", type.id)
      .not("drifter_name", "is", null)
      .order("created_at", { ascending: false })
      .limit(25),
    // The other door into this pool: bands issued by converting a paid order.
    // Those never touch walkin_sales, so without this the tab looks empty while
    // the stock count has already dropped.
    admin
      .from("tickets")
      .select("number, holder_name, status, order:orders(id, order_no, buyer_name, status)")
      .eq("ticket_type_id", type.id)
      .order("number"),
    admin
      .from("order_items")
      .select("order_id, qty, unit_price_centavos")
      .eq("ticket_type_id", type.id),
  ]);

  type RecentRow = {
    id: string; created_at: string; drifter_name: string; team_name: string | null; qty: number; free_qty: number;
    unit_price_centavos: number; payment_method: PaymentMethod; staff: { full_name: string } | null;
  };
  const recent: DrifterEntry[] = ((recentRows ?? []) as unknown as RecentRow[]).map((r) => ({
    id: r.id,
    created_at: r.created_at,
    drifter_name: r.drifter_name,
    team_name: r.team_name,
    qty: r.qty,
    free_qty: r.free_qty,
    unit_price_centavos: r.unit_price_centavos,
    payment_method: r.payment_method,
    staff: r.staff?.full_name ?? null,
  }));

  type OrderTicket = {
    number: string; holder_name: string | null; status: string;
    order: { id: string; order_no: number; buyer_name: string; status: string } | null;
  };
  const priceByOrder = new Map((orderLines ?? []).map((l) => [l.order_id as string, Number(l.unit_price_centavos)]));
  const byOrder = new Map<string, OrderBandRow>();
  for (const t of ((orderTickets ?? []) as unknown as OrderTicket[])) {
    // A void ticket gave its band back, so it is no longer out there.
    if (!t.order || (t.status !== "issued" && t.status !== "redeemed")) continue;
    const row = byOrder.get(t.order.id) ?? {
      order_id: t.order.id,
      order_no: t.order.order_no,
      buyer_name: t.order.buyer_name,
      holder_name: t.holder_name,
      numbers: [],
      amount_centavos: 0,
    };
    row.numbers.push(t.number);
    row.amount_centavos += priceByOrder.get(t.order.id) ?? 0;
    byOrder.set(t.order.id, row);
  }
  const orderBands = [...byOrder.values()].sort((a, b) => b.order_no - a.order_no);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{type.name}</h1>
        <p className="mt-2 text-sm text-zinc-500">
          Wristbands for a competing drifter and the people with them. Type the drifter&apos;s name, read them the rules below, then tap
          the number of bands handed over. The first <b>{type.free_allowance}</b> per drifter are free; anything beyond that is charged.
          These bands never mix with the Walk-in tally, so the gate numbers stay clean. Bands can also reach a team through a converted
          order &mdash; those are listed separately below and are already paid for.
        </p>
      </div>
      <DrifterBands
        type={type}
        avail={availability.find((a) => a.ticket_type_id === type.id)}
        drifters={(drifterRows ?? []) as DrifterBandRow[]}
        recent={recent}
        orderBands={orderBands}
        isAdmin={session.staff.role === "admin"}
      />
    </div>
  );
}
