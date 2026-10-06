import Link from "next/link";
import type { Metadata } from "next";
import { OrderForm } from "@/components/OrderForm";
import { EventHero } from "@/components/EventHero";
import { Reveal } from "@/components/Reveal";
import { SupportContact } from "@/components/SupportContact";
import { getActiveEvent, getAvailability, getTicketTypes, isSalesOpen, publicAvailability, publicOrder } from "@/lib/queries";
import { fmtCutoff, isTypeClosed } from "@/lib/cutoff";
import { php } from "@/lib/money";
import { primaryChannel } from "@/config/event";
import { getRules } from "@/lib/rules";

export const dynamic = "force-dynamic";

// The title is the root layout's default ("<event> · Tickets"); only the description
// is phrased for the sales page. Setting a title string here would run it through
// the layout's "%s · <event>" template and name the event twice.
export async function generateMetadata(): Promise<Metadata> {
  const [event, rules] = await Promise.all([getActiveEvent(), getRules()]);
  return {
    description: event ? `${event.name}${event.venue ? ` at ${event.venue}` : ""}. Pay via ${primaryChannel(event, rules.channels).payVia}.` : undefined,
  };
}

export default async function HomePage() {
  const [event, rules] = await Promise.all([getActiveEvent(), getRules()]);
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
  const open = isSalesOpen(event) && types.some((t) => !isTypeClosed(t));
  const lastClose = types.map((t) => t.sales_close_at).filter((x): x is string => !!x).sort().pop() ?? null;

  // Admission summary: cheapest general tickets first (adult / child), then VIPs
  const prices = types
    .filter((t) => !t.includes_shirt && !t.includes_lanyard && !t.requires_vehicle)
    .map((t) => ({ label: t.is_child ? "Children" : "Adult", price: php(t.price_centavos) }));

  // overflow-x-clip (not hidden): off-screen reveal transforms and hero glows
  // must not create a sideways scroll on phones, and clip keeps the sticky
  // total bar working, which an overflow:hidden ancestor would break.
  return (
    <main className="flex-1 overflow-x-clip bg-brand">
      <EventHero event={event} prices={prices} />

      <section id="tickets" className="dark-zone mx-auto max-w-3xl px-4 pb-16 pt-6 sm:px-8">
        <Reveal className="mb-8 flex items-end justify-between" from="left">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Tickets</p>
            <h2 className="reveal-title text-2xl font-black uppercase italic sm:text-3xl">Secure your spot</h2>
          </div>
          <p className="hidden text-right text-xs text-zinc-400 sm:block">
            Pay via {primaryChannel(event, rules.channels).payVia}.<br />Tickets emailed after verification (check Spam too).
          </p>
        </Reveal>

        {open ? (
          <OrderForm types={types} availability={publicAvailability(availability, types)} channel={primaryChannel(event, rules.channels)} />
        ) : (
          <Reveal from="zoom" className="card text-center">
            <h2 className="text-xl font-bold">Online ticket sales are closed</h2>
            <p className="mt-2 text-zinc-400">{lastClose ? `Online sales ended ${fmtCutoff(lastClose)}. ` : ""}Tickets may still be available at the venue gate.</p>
            <p className="mt-1 text-xs text-zinc-500">Sarado na ang online ticket sales. Maaaring may tickets pa sa gate ng venue.</p>
          </Reveal>
        )}

        <div className="mt-10 flex justify-center"><SupportContact event={event} compact /></div>
        <p className="mt-3 text-center text-xs text-zinc-500">
          Payment via {primaryChannel(event, rules.channels).payVia}. Tickets are emailed after payment verification. <Link href="/login" className="underline">Staff login</Link>
        </p>
      </section>
    </main>
  );
}
