import { requireStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveEvent, getAvailability, getTicketTypes } from "@/lib/queries";
import { DrifterBands, type DrifterEntry } from "@/components/DrifterBands";
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
  const [{ data: drifterRows }, { data: recentRows }] = await Promise.all([
    admin.from("v_drifter_bands").select("*").eq("ticket_type_id", type.id).order("drifter_name"),
    admin
      .from("walkin_sales")
      .select("id, created_at, drifter_name, qty, free_qty, unit_price_centavos, payment_method, staff:staff(full_name)")
      .eq("ticket_type_id", type.id)
      .not("drifter_name", "is", null)
      .order("created_at", { ascending: false })
      .limit(25),
  ]);

  type RecentRow = {
    id: string; created_at: string; drifter_name: string; qty: number; free_qty: number;
    unit_price_centavos: number; payment_method: PaymentMethod; staff: { full_name: string } | null;
  };
  const recent: DrifterEntry[] = ((recentRows ?? []) as unknown as RecentRow[]).map((r) => ({
    id: r.id,
    created_at: r.created_at,
    drifter_name: r.drifter_name,
    qty: r.qty,
    free_qty: r.free_qty,
    unit_price_centavos: r.unit_price_centavos,
    payment_method: r.payment_method,
    staff: r.staff?.full_name ?? null,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Drifters</h1>
        <p className="mt-2 text-sm text-zinc-500">
          Family wristbands for the drivers competing on the day. Type the drifter&apos;s name and tap the number of bands handed over.
          The first <b>{type.free_allowance}</b> per drifter are free; anything beyond that is charged. These bands never mix with the
          Walk-in tally, so the gate numbers stay clean.
        </p>
      </div>
      <DrifterBands
        type={type}
        avail={availability.find((a) => a.ticket_type_id === type.id)}
        drifters={(drifterRows ?? []) as DrifterBandRow[]}
        recent={recent}
        isAdmin={session.staff.role === "admin"}
      />
    </div>
  );
}
