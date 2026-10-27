import Link from "next/link";
import type { Metadata } from "next";
import { OrderForm } from "@/components/OrderForm";
import { EventHero } from "@/components/EventHero";
import { EventInfo } from "@/components/EventInfo";
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

  // Registration fees in the hero: every type sold online, e.g. "₱500 per car".
  const prices = types.map((t) => ({ label: t.requires_vehicle ? "per car" : t.name, price: php(t.price_centavos) }));

  // overflow-x-clip (not hidden): off-screen reveal transforms and hero glows
  // must not create a sideways scroll on phones, and clip keeps the sticky
  // total bar working, which an overflow:hidden ancestor would break.
  return (
    <main className="flex-1 overflow-x-clip bg-brand">
      <EventHero event={event} prices={prices} />
      <EventInfo event={event} />

      <section id="tickets" className="dark-zone mx-auto max-w-5xl px-4 pb-16 pt-8 sm:px-8">
        <Reveal className="mb-10 flex items-end justify-between gap-6" from="left">
          <h2 className="reveal-title display-title text-[2.4rem] sm:text-[3.4rem]">Register your car</h2>
          <p className="hidden text-right text-sm text-zinc-400 sm:block">
            Pay via {primaryChannel(event, rules.channels).payVia}.<br />Your QR pass is emailed after we check your payment (check Spam too).
          </p>
        </Reveal>

        {open ? (
          <OrderForm types={types} availability={publicAvailability(availability, types)} channel={primaryChannel(event, rules.channels)} />
        ) : (
          <Reveal from="up" className="border-y border-white/10 py-10 text-center sm:py-14">
            <h3 className="display-title text-[1.7rem] text-white sm:text-[2.4rem]" style={{ textShadow: "0 0 32px color-mix(in srgb, var(--neon-pink) 40%, transparent)" }}>Online sales are closed</h3>
            <p className="mx-auto mt-4 max-w-xl text-zinc-300">{lastClose ? `Online sales ended ${fmtCutoff(lastClose)}. ` : ""}Tickets may still be available at the venue gate.</p>
            <p className="mt-1 text-sm text-zinc-500">Sarado na ang online ticket sales. Maaaring may tickets pa sa gate ng venue.</p>
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
