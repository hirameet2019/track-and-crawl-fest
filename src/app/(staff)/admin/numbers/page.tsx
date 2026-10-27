import { requireSystem } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveEvent, getAvailability, getTicketTypes } from "@/lib/queries";
import { NumberForms } from "@/components/NumberForms";

export default async function NumbersPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  await requireSystem();
  const { type } = await searchParams;
  const event = await getActiveEvent();
  if (!event) return <p>No active event.</p>;
  const [types, availability] = await Promise.all([getTicketTypes(event.id), getAvailability(event.id)]);
  const selected = types.find((t) => t.id === type) ?? types[0];

  const admin = createAdminClient();
  const { data: numbers } = selected
    ? await admin.from("ticket_numbers").select("id, number, seq, status, void_reason").eq("ticket_type_id", selected.id).order("seq").limit(2000)
    : { data: [] };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Wristband numbers</h1>
        <p className="text-sm text-zinc-500">Import the serials printed on the wristbands, per ticket type. The system hands them out in order as tickets are paid. Void a number if a band is damaged; it will be skipped.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {availability.map((a) => (
          <a key={a.ticket_type_id} href={`?type=${a.ticket_type_id}`} className={`card block ${selected?.id === a.ticket_type_id ? "ring-2 ring-zinc-900" : ""}`}>
            <div className="font-semibold">{a.name}</div>
            <div className="mt-1 text-xs text-zinc-500">{a.band_color ? `${a.band_color} band` : "No band colour"}{a.pool_type_id && <> · uses the {availability.find((x) => x.ticket_type_id === a.pool_type_id)?.code} stack</>}</div>
            <div className="mt-2 grid grid-cols-3 text-center text-xs">
              <div><div className="text-lg font-bold">{a.pool_total}</div>pool</div>
              <div><div className="text-lg font-bold">{a.sold}</div>used</div>
              <div><div className="text-lg font-bold">{a.pool_available}</div>free</div>
            </div>
          </a>
        ))}
      </div>

      {selected?.pool_type_id ? (
        <p className="card text-sm text-zinc-400">
          {selected.name} has no serials of its own: it hands out the next free {types.find((t) => t.id === selected.pool_type_id)?.code} wristband, first come first served with {types.find((t) => t.id === selected.pool_type_id)?.name}. Import or void those numbers on {types.find((t) => t.id === selected.pool_type_id)?.name}.
        </p>
      ) : (
        selected && <NumberForms ticketType={selected} numbers={numbers ?? []} />
      )}
    </div>
  );
}
