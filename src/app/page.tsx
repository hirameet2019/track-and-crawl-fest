import Link from "next/link";
import type { Metadata } from "next";
import { OrderForm } from "@/components/OrderForm";
import { EventHero } from "@/components/EventHero";
import { EventInfo } from "@/components/EventInfo";
import { vehicleWords } from "@/lib/vehicle";
import { Reveal } from "@/components/Reveal";
import { SupportContact } from "@/components/SupportContact";
import { getActiveEvent, getAvailability, getTicketTypes, isSalesOpen, publicAvailability, publicOrder } from "@/lib/queries";
import { fmtCutoff, isTypeClosed } from "@/lib/cutoff";
import { php } from "@/lib/money";
import { primaryChannel } from "@/config/event";
import { getRules } from "@/lib/rules";
import { fillText } from "@/lib/rules-types";
import { siteText } from "@/lib/site-text";

export const dynamic = "force-dynamic";

// The title is the root layout's default ("<event> · Tickets"); only the description
// is phrased for the sales page. Setting a title string here would run it through
// the layout's "%s · <event>" template and name the event twice.
export async function generateMetadata(): Promise<Metadata> {
  const [event, rules] = await Promise.all([getActiveEvent(), getRules()]);
  return {
    description: event
      ? siteText(rules.text)("meta.homeDescription", { event: event.name, at: event.venue ? ` at ${event.venue}` : "", pay: primaryChannel(event, rules.channels, rules.extraChannels).payVia })
      : undefined,
  };
}

export default async function HomePage() {
  const [event, rules] = await Promise.all([getActiveEvent(), getRules()]);
  const tx = siteText(rules.text);
  if (!event) {
    return (
      <main className="mx-auto max-w-2xl p-8 text-center">
        <h1 className="text-2xl font-bold">{tx("home.noEventTitle")}</h1>
        {tx("home.noEventText") && <p className="mt-2 text-zinc-600">{tx("home.noEventText")}</p>}
      </main>
    );
  }
  const [allTypes, availability] = await Promise.all([getTicketTypes(event.id, { onlineOnly: true }), getAvailability(event.id)]);
  const types = publicOrder(allTypes);
  const open = isSalesOpen(event) && types.some((t) => !isTypeClosed(t));
  const lastClose = types.map((t) => t.sales_close_at).filter((x): x is string => !!x).sort().pop() ?? null;

  // Registration fees in the hero: every type sold online, e.g. "₱500 per car".
  const { page } = rules;
  const channel = primaryChannel(event, rules.channels, rules.extraChannels);
  const fill = (text: string) => fillText(text, { pay: channel.payVia, via: channel.via, minutes: rules.paymentWindowMinutes });

  const prices = types.map((t) => ({ label: t.requires_vehicle ? tx("hero.pricePer", { noun: vehicleWords(t).noun }) : t.name, price: php(t.price_centavos) }));

  // overflow-x-clip (not hidden): off-screen reveal transforms and hero glows
  // must not create a sideways scroll on phones, and clip keeps the sticky
  // total bar working, which an overflow:hidden ancestor would break.
  return (
    <main className="flex-1 overflow-x-clip bg-brand">
      <EventHero event={event} prices={prices} />
      <EventInfo event={event} />

      <section id="tickets" className="dark-zone mx-auto max-w-5xl px-4 pb-16 pt-8 sm:px-8">
        <Reveal className="mb-10 flex items-end justify-between gap-6" from="left">
          <h2 className="reveal-title display-title text-[2.4rem] sm:text-[3.4rem]">{fill(page.heading)}</h2>
          {page.show.sideNote && page.sideNote && (
            <p className="hidden whitespace-pre-line text-right text-sm text-zinc-400 sm:block">{fill(page.sideNote)}</p>
          )}
        </Reveal>

        {open ? (
          <OrderForm types={types} availability={publicAvailability(availability, types)} channel={channel} />
        ) : (
          <Reveal from="up" className="border-y border-white/10 py-10 text-center sm:py-14">
            <h3 className="display-title text-[1.7rem] text-white sm:text-[2.4rem]" style={{ textShadow: "0 0 32px color-mix(in srgb, var(--neon-pink) 40%, transparent)" }}>{fill(page.closedTitle)}</h3>
            <p className="mx-auto mt-4 max-w-xl text-zinc-300">{lastClose ? `${tx("home.salesEnded", { date: fmtCutoff(lastClose) })} ` : ""}{fill(page.closedText)}</p>
            {page.closedTextTl && <p className="mt-1 text-sm text-zinc-500">{fill(page.closedTextTl)}</p>}
          </Reveal>
        )}

        {page.show.support && <div className="mt-10 flex justify-center"><SupportContact event={event} compact /></div>}
        {((page.show.footerNote && page.footerNote) || page.show.staffLink) && (
          <p className="mt-3 text-center text-xs text-zinc-500">
            {page.show.footerNote && page.footerNote && <>{fill(page.footerNote)} </>}
            {page.show.staffLink && <Link href="/login" className="underline">{tx("home.staffLink")}</Link>}
          </p>
        )}
      </section>
    </main>
  );
}
