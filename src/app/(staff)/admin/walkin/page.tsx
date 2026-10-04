import { requireStaff } from "@/lib/auth";
import { hasRole } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveEvent, getAvailability, getTicketTypes } from "@/lib/queries";
import { WalkinTally, type GateCar, type TallyEntry, type TallyToday } from "@/components/WalkinTally";
import type { PaymentMethod } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

/** Start of today in Asia/Manila as an ISO string. */
function manilaDayStart(): string {
  const now = new Date();
  const ymd = now.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  return new Date(`${ymd}T00:00:00+08:00`).toISOString();
}

export default async function WalkinPage() {
  const session = await requireStaff("gate");
  const seesDrifters = hasRole(session.staff.role, "staff");
  const event = await getActiveEvent();
  if (!event) return <p>No active event.</p>;

  const admin = createAdminClient();
  const dayStart = manilaDayStart();
  // Drifter family bands share the table but never the gate tally: they have their own tab.
  const [types, availability, { data: todayRows }, { data: recentRows }, { data: shirtRows }, { data: carRows }] = await Promise.all([
    getTicketTypes(event.id),
    getAvailability(event.id),
    admin.from("walkin_sales").select("ticket_type_id, qty, free_qty, unit_price_centavos, payment_method").eq("event_id", event.id).is("drifter_name", null).gte("created_at", dayStart),
    admin
      .from("walkin_sales")
      .select("id, created_at, qty, free_qty, unit_price_centavos, payment_method, shirt_size, holder_name, vehicle_plate, ticket_type:ticket_types(name, walkin_name, code, band_color), staff:staff(full_name)")
      .eq("event_id", event.id)
      .is("drifter_name", null)
      .order("created_at", { ascending: false })
      .limit(25),
    admin.from("walkin_sales").select("ticket_type_id, shirt_size, qty, free_qty").eq("event_id", event.id).not("shirt_size", "is", null),
    admin
      .from("walkin_sales")
      .select("ticket_type_id, created_at, qty, free_qty, shirt_size, holder_name, vehicle_plate")
      .eq("event_id", event.id)
      .not("vehicle_plate", "is", null)
      .order("created_at"),
  ]);

  // Cars sold at the gate and still in (sales minus take-backs), per label, newest first.
  const plateKey = (p: string) => p.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const carMap = new Map<string, GateCar & { typeId: string; net: number }>();
  for (const r of carRows ?? []) {
    const k = `${r.ticket_type_id}|${plateKey(r.vehicle_plate as string)}`;
    const cur = carMap.get(k) ?? { typeId: r.ticket_type_id, net: 0, plate: r.vehicle_plate as string, name: "", size: null, at: r.created_at };
    cur.net += r.qty - r.free_qty;
    if (r.qty > 0) Object.assign(cur, { plate: r.vehicle_plate, name: r.holder_name ?? "", size: r.shirt_size, at: r.created_at });
    carMap.set(k, cur);
  }
  const cars: Record<string, GateCar[]> = {};
  for (const c of [...carMap.values()].filter((c) => c.net > 0).sort((x, y) => y.at.localeCompare(x.at))) {
    (cars[c.typeId] ??= []).push({ plate: c.plate, name: c.name, size: c.size, at: c.at });
  }

  // A sale is qty - free_qty: one band, or one car whose passenger bands are free.
  const today: TallyToday = { byType: {}, byMethod: { cash: 0, gotyme: 0, gcash: 0, maya: 0 }, total_centavos: 0, entries: 0 };
  for (const r of todayRows ?? []) {
    const sales = r.qty - r.free_qty;
    const amt = sales * r.unit_price_centavos;
    const t = (today.byType[r.ticket_type_id] ??= { sales: 0, centavos: 0 });
    t.sales += sales;
    t.centavos += amt;
    today.byMethod[r.payment_method as PaymentMethod] += amt;
    today.total_centavos += amt;
    today.entries += 1;
  }

  // Shirts handed over at the gate so far, per label and size (net of corrections).
  const shirts: Record<string, Record<string, number>> = {};
  for (const r of shirtRows ?? []) {
    const bySize = (shirts[r.ticket_type_id] ??= {});
    bySize[r.shirt_size as string] = (bySize[r.shirt_size as string] ?? 0) + (r.qty - r.free_qty);
  }

  type RecentRow = {
    id: string; created_at: string; qty: number; free_qty: number; unit_price_centavos: number; payment_method: PaymentMethod; shirt_size: string | null;
    holder_name: string | null; vehicle_plate: string | null;
    ticket_type: { name: string; walkin_name: string | null; code: string; band_color: string | null } | null;
    staff: { full_name: string } | null;
  };
  const recent: TallyEntry[] = ((recentRows ?? []) as unknown as RecentRow[]).map((r) => ({
    id: r.id,
    created_at: r.created_at,
    qty: r.qty,
    free_qty: r.free_qty,
    unit_price_centavos: r.unit_price_centavos,
    payment_method: r.payment_method,
    shirt_size: r.shirt_size,
    holder_name: r.holder_name,
    vehicle_plate: r.vehicle_plate,
    type_name: r.ticket_type?.walkin_name ?? r.ticket_type?.name ?? "",
    code: r.ticket_type?.code ?? "",
    band_color: r.ticket_type?.band_color ?? null,
    staff: r.staff?.full_name ?? null,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Walk-in</h1>
        <p className="mt-2 text-sm text-zinc-500">
          Gate sales are a plain count: collect the payment, hand over the wristband, tap <b>+1</b> on that label. No name or contact is taken and no ticket is emailed.
          Tap <b>−</b> to undo a mistake. Every tap deducts from the wristbands left for that label. For a label with a shirt, pick the size
          you handed over first; a VIP Car with shirt counts as one car, with a band for the driver and one for the passenger.
        </p>
        <p className="mt-1 text-sm text-zinc-500">
          {seesDrifters
            ? <>Bands for a competing drifter&apos;s family go on the <b>Drifters</b> tab instead, recorded under the driver&apos;s name.</>
            : <>A competing drifter&apos;s family does not buy here: send them to the registration desk.</>}
        </p>
      </div>
      <WalkinTally
        types={types.filter((t) => t.sell_at_gate && !t.drifter_family)}
        availability={availability}
        today={today}
        recent={recent}
        shirts={shirts}
        cars={cars}
        isAdmin={session.staff.role === "admin"}
      />
    </div>
  );
}
