import { requireStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveEvent, getAvailability, getTicketTypes } from "@/lib/queries";
import { WalkinTally, type TallyEntry, type TallyToday } from "@/components/WalkinTally";
import type { PaymentMethod } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

/** Start of today in Asia/Manila as an ISO string. */
function manilaDayStart(): string {
  const now = new Date();
  const ymd = now.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  return new Date(`${ymd}T00:00:00+08:00`).toISOString();
}

export default async function WalkinPage() {
  const session = await requireStaff("staff");
  const event = await getActiveEvent();
  if (!event) return <p>No active event.</p>;

  const admin = createAdminClient();
  const dayStart = manilaDayStart();
  const [types, availability, { data: todayRows }, { data: recentRows }] = await Promise.all([
    getTicketTypes(event.id),
    getAvailability(event.id),
    admin.from("walkin_sales").select("ticket_type_id, qty, unit_price_centavos, payment_method").eq("event_id", event.id).gte("created_at", dayStart),
    admin
      .from("walkin_sales")
      .select("id, created_at, qty, unit_price_centavos, payment_method, ticket_type:ticket_types(name, code, band_color), staff:staff(full_name)")
      .eq("event_id", event.id)
      .order("created_at", { ascending: false })
      .limit(25),
  ]);

  const today: TallyToday = { byType: {}, byMethod: { cash: 0, gotyme: 0, gcash: 0, maya: 0 }, total_centavos: 0, entries: 0 };
  for (const r of todayRows ?? []) {
    const amt = r.qty * r.unit_price_centavos;
    const t = (today.byType[r.ticket_type_id] ??= { qty: 0, centavos: 0 });
    t.qty += r.qty;
    t.centavos += amt;
    today.byMethod[r.payment_method as PaymentMethod] += amt;
    today.total_centavos += amt;
    today.entries += 1;
  }

  type RecentRow = {
    id: string; created_at: string; qty: number; unit_price_centavos: number; payment_method: PaymentMethod;
    ticket_type: { name: string; code: string; band_color: string | null } | null;
    staff: { full_name: string } | null;
  };
  const recent: TallyEntry[] = ((recentRows ?? []) as unknown as RecentRow[]).map((r) => ({
    id: r.id,
    created_at: r.created_at,
    qty: r.qty,
    unit_price_centavos: r.unit_price_centavos,
    payment_method: r.payment_method,
    type_name: r.ticket_type?.name ?? "",
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
          Tap <b>−</b> to undo a mistake. Every tap deducts from the wristbands left for that label.
        </p>
        <p className="mt-1 text-sm text-zinc-500">
          Bands for a competing drifter&apos;s family go on the <b>Drifters</b> tab instead, recorded under the driver&apos;s name.
        </p>
      </div>
      <WalkinTally types={types.filter((t) => !t.drifter_family)} availability={availability} today={today} recent={recent} isAdmin={session.staff.role === "admin"} />
    </div>
  );
}
