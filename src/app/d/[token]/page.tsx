import type { Metadata } from "next";
import { EventBanner } from "@/components/EventHero";
import { DrifterRegistrationForm } from "@/components/DrifterRegistrationForm";
import { RememberThisLink } from "@/components/DrifterLinkMemory";
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

  const paidBox = entry.paid_centavos > 0 && (
    <div className="mx-auto mt-4 max-w-xs rounded-xl border border-emerald-400/30 bg-emerald-400/5 p-3 text-sm">
      <div className="font-semibold text-emerald-200">Payment received: {php(entry.paid_centavos)}</div>
      <div className="mt-0.5 text-xs text-zinc-400">
        For the bands past the free {type.free_allowance}
        {entry.payment_method ? ` · ${entry.payment_method === "cash" ? "cash" : entry.payment_method.toUpperCase()}` : ""}
        {entry.payment_ref ? ` · ref ${entry.payment_ref}` : ""}
      </div>
    </div>
  );
  const nameList = (
    <ol className="mx-auto mt-4 max-w-sm divide-y divide-white/10 rounded-lg border border-white/10 text-left text-sm">
      {entry.people.map((p, i) => (
        <li key={i} className="flex items-center justify-between gap-3 px-3 py-2">
          <span className="min-w-0 truncate"><span className="mr-2 text-xs text-zinc-500 tabular-nums">{i + 1}</span>{p.name}</span>
          <span className={`shrink-0 text-xs ${p.given_at ? "text-emerald-300" : "text-amber-300"}`}>{p.given_at ? "collected" : "not yet"}</span>
        </li>
      ))}
    </ol>
  );

  // Some of the group has collected, some has not: the list is now handled at the desk.
  if (!entry.handed_over_at && entry.bands_given > 0) {
    const left = (entry.band_count ?? 0) - entry.bands_given;
    return shell(
      <div className="card text-center">
        <RememberThisLink token={entry.token} name={entry.drifter_name} />
        <h1 className="text-xl font-bold">{entry.bands_given} of {entry.band_count} collected</h1>
        <p className="mt-2 text-sm text-zinc-400">
          {left} {left === 1 ? "person" : "people"} on {entry.drifter_name}&rsquo;s list can still collect at the registration desk.
          They give your name or the code below.
        </p>
        <p className="mt-1 text-xs text-zinc-500">Pwede pang kunin ng iba sa registration desk. Ibigay lang ang pangalan mo o ang code.</p>
        <p className="mt-3 font-mono text-lg font-bold text-cyan-300">{drifterReference(entry.token)}</p>
        {nameList}
        {paidBox}
        <p className="mt-4 text-xs text-zinc-500">Need to change the list? Ask at the registration desk.</p>
      </div>,
    );
  }

  if (entry.handed_over_at) {
    return shell(
      <div className="card text-center">
        <RememberThisLink token={entry.token} name={entry.drifter_name} />
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full border border-emerald-400/40 bg-emerald-400/10 text-2xl text-emerald-300" aria-hidden>&#10003;</div>
        <h1 className="mt-4 text-xl font-bold">Wristbands handed over</h1>
        <p className="mt-2 text-sm text-zinc-400">
          All {entry.band_count} wristband{entry.band_count === 1 ? "" : "s"} for {entry.drifter_name}&rsquo;s group were handed over at the registration desk; the last on{" "}
          {new Date(entry.handed_over_at).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" })}.
        </p>
        {entry.people.length > 0 && nameList}
        {paidBox}
        <p className="mt-3 font-mono text-sm text-zinc-500">{drifterReference(entry.token)}</p>
        <p className="mt-3 text-xs text-zinc-500">Need more bands? Ask at the registration desk.</p>
      </div>,
    );
  }

  return shell(
    <>
      <RememberThisLink token={entry.token} name={entry.drifter_name} />
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
