import type { Metadata } from "next";
import { EventBanner } from "@/components/EventHero";
import { DrifterRegistrationForm } from "@/components/DrifterRegistrationForm";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveEvent } from "@/lib/queries";
import { drifterReference } from "@/lib/drifter";
import { php } from "@/lib/money";
import type { DrifterEntryRow, TicketTypeRow } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

// A private link: keep it out of search results and link previews.
export const metadata: Metadata = {
  title: "Drifter wristbands · Meet & Drift 3",
  robots: { index: false, follow: false },
};

/**
 * A competing drifter's private pre-registration link. The token is the only key:
 * no login, and the page never shows any other drifter. Name and team come from
 * the organizer's entry list.
 */
export default async function DrifterLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const event = await getActiveEvent();
  const admin = createAdminClient();

  const { data } = token.length >= 10 && token.length <= 40
    ? await admin.from("drifter_entries").select("*").eq("token", token).maybeSingle()
    : { data: null };
  const entry = data as DrifterEntryRow | null;

  const { data: typeRow } = entry
    ? await admin.from("ticket_types").select("*").eq("id", entry.ticket_type_id).maybeSingle()
    : { data: null };
  const type = typeRow as TicketTypeRow | null;

  const shell = (children: React.ReactNode) => (
    <main className="flex flex-1 flex-col bg-[#0a0a0c]">
      {event && <EventBanner event={event} backLabel="Meet & Drift 3" />}
      <div className="dark-zone mx-auto w-full max-w-xl flex-1 px-4 py-8">{children}</div>
    </main>
  );

  // Same message for a wrong token and a closed one, so the page confirms nothing.
  if (!entry || !entry.active || !type) {
    return shell(
      <div className="card text-center">
        <h1 className="text-xl font-bold">This link is not active</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Check that you opened the whole link from the organizer&rsquo;s message. If it still does not work, ask the organizer for a new one.
        </p>
        <p className="mt-2 text-xs text-zinc-500">Hindi aktibo ang link na ito. Humingi ng bago sa organizer.</p>
      </div>,
    );
  }

  if (entry.handed_over_at) {
    return shell(
      <div className="card text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full border border-emerald-400/40 bg-emerald-400/10 text-2xl text-emerald-300" aria-hidden>&#10003;</div>
        <h1 className="mt-4 text-xl font-bold">Wristbands handed over</h1>
        <p className="mt-2 text-sm text-zinc-400">
          {entry.band_count} wristband{entry.band_count === 1 ? "" : "s"} for {entry.drifter_name} were handed over at the registration desk on{" "}
          {new Date(entry.handed_over_at).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" })}.
        </p>
        <p className="mt-3 font-mono text-sm text-zinc-500">{drifterReference(entry.token)}</p>
        <p className="mt-3 text-xs text-zinc-500">Need more bands? Ask at the registration desk.</p>
      </div>,
    );
  }

  return shell(
    <>
      <div className="mb-5">
        <h1 className="text-2xl font-bold">Drifter wristbands</h1>
        <p className="mt-1 text-sm text-zinc-400">
          List the people coming with you and confirm the rules. Your wristbands will be ready at the registration desk on event day.
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          Ilista ang mga kasama mo at kumpirmahin ang mga patakaran. Nakahanda na ang wristbands sa registration desk sa araw ng event.
        </p>
      </div>
      <DrifterRegistrationForm
        token={entry.token}
        drifterName={entry.drifter_name}
        teamName={entry.team_name}
        carNo={entry.car_no}
        allowance={type.free_allowance}
        priceLabel={php(type.walkin_price_centavos ?? type.price_centavos)}
        initialPeople={entry.people ?? []}
        submittedAt={entry.submitted_at}
      />
    </>,
  );
}
