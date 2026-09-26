import type { Metadata } from "next";
import { EventBanner } from "@/components/EventHero";
import { DrifterRegistrationForm } from "@/components/DrifterRegistrationForm";
import { LostDrifterLink, RememberedDrifterLinks } from "@/components/DrifterLinkMemory";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveEvent } from "@/lib/queries";
import { php } from "@/lib/money";
import { SITE_URL } from "@/config/event";
import type { TicketTypeRow } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

// Shared with drifters only: keep it out of search results.
export const metadata: Metadata = {
  title: "Drifter sign-up · Meet & Drift 3",
  robots: { index: false, follow: false },
};

/**
 * The organizer's shared drifter sign-up link. Used when there is no final entry
 * list to make personal links from: the drifter says who they are, lists the
 * people with them and confirms the rules, then gets their own personal link.
 */
export default async function DrifterSignupPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = await getActiveEvent();
  const admin = createAdminClient();

  const { data } = slug.length >= 10 && slug.length <= 40
    ? await admin.from("ticket_types").select("*").eq("drifter_signup_slug", slug).eq("drifter_family", true).eq("active", true).maybeSingle()
    : { data: null };
  const type = data as TicketTypeRow | null;

  return (
    <main className="flex flex-1 flex-col bg-[#0a0a0c]">
      {event && <EventBanner event={event} backLabel="Meet & Drift 3" />}
      <div className="dark-zone mx-auto w-full max-w-xl flex-1 px-4 py-8">
        {!type ? (
          <div className="card text-center">
            <h1 className="text-xl font-bold">This sign-up link is closed</h1>
            <p className="mt-2 text-sm text-zinc-400">
              The organizer may have replaced it with a new one. Ask them for the current drifter sign-up link.
            </p>
            <p className="mt-2 text-xs text-zinc-500">Sarado na ang link na ito. Humingi ng bago sa organizer.</p>
            <RememberedDrifterLinks />
            <LostDrifterLink />
          </div>
        ) : (
          <>
            <RememberedDrifterLinks />
            <div className="mb-5">
              <h1 className="text-2xl font-bold">Drifter sign-up</h1>
              <p className="mt-1 text-sm text-zinc-400">
                For drivers competing at {event?.name ?? "the event"}. Tell us who you are, list the people coming with you and confirm the rules.
                Your wristbands will be ready at the registration desk; bring your competitor pass.
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                Para sa mga drifter na kasali. Ilagay ang pangalan mo, ang mga kasama mo, at kumpirmahin ang mga patakaran. Dalhin ang competitor pass sa registration desk.
              </p>
            </div>
            <DrifterRegistrationForm
              mode="signup"
              slug={slug}
              siteUrl={SITE_URL}
              allowance={type.free_allowance}
              priceLabel={php(type.walkin_price_centavos ?? type.price_centavos)}
            />
            <LostDrifterLink />
          </>
        )}
      </div>
    </main>
  );
}
