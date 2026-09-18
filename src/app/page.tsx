import Link from "next/link";
import type { Metadata } from "next";
import { OrderForm } from "@/components/OrderForm";
import { EventHero } from "@/components/EventHero";
import { getActiveEvent, getAvailability, getTicketTypes, isSalesOpen, publicOrder } from "@/lib/queries";
import { php } from "@/lib/money";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const event = await getActiveEvent();
  return {
    title: event ? `${event.name} · Tickets` : "Tickets",
    description: event ? `${event.name}${event.venue ? ` at ${event.venue}` : ""}. Pay via GCash or Maya.` : undefined,
  };
}

export default async function HomePage() {
  const event = await getActiveEvent();
  if (!event) {
    return (
      <main className="mx-auto max-w-2xl p-8 text-center">
        <h1 className="text-2xl font-bold">No event is on sale right now.</h1>
        <p className="mt-2 text-zinc-600">Run the database migration and seed, then refresh.</p>
      </main>
    );
  }
  const [allTypes, availability] = await Promise.all([getTicketTypes(event.id, { onlineOnly: true }), getAvailability(event.id)]);
  const types = publicOrder(allTypes);
  const open = isSalesOpen(event);

  // Admission summary: cheapest general tickets first (adult / child), then VIPs
  const prices = types
    .filter((t) => !t.includes_shirt)
    .map((t) => ({ label: t.is_child ? "Children" : "Adult", price: php(t.price_centavos) }));

  return (
    <main className="flex-1 bg-[#0a0a0c]">
      <EventHero event={event} prices={prices} />

      <section id="tickets" className="dark-zone mx-auto max-w-3xl px-4 pb-16 pt-6 sm:px-8">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Tickets</p>
            <h2 className="text-2xl font-black uppercase italic">Secure your spot</h2>
          </div>
          <p className="hidden text-right text-xs text-zinc-400 sm:block">
            Pay via GCash or Maya.<br />Tickets emailed after verification.
          </p>
        </div>

        {open ? (
          <OrderForm types={types} availability={availability} />
        ) : (
          <div className="card text-center">
            <h2 className="text-xl font-bold">Online ticket sales are closed</h2>
            <p className="mt-2 text-zinc-400">Tickets may still be available at the venue gate.</p>
          </div>
        )}

        <p className="mt-10 text-center text-xs text-zinc-500">
          Payment via GCash or Maya. Tickets are emailed after payment verification. <Link href="/login" className="underline">Staff login</Link>
        </p>
      </section>
    </main>
  );
}
