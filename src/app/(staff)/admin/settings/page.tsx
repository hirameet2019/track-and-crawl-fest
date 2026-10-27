import Link from "next/link";
import { requireSystem } from "@/lib/auth";
import { getEmailSettings } from "@/lib/settings";
import { EmailSettingsForm } from "@/components/EmailSettingsForm";
import { SalesScheduleForm } from "@/components/SalesScheduleForm";
import { EventDetailsForm } from "@/components/EventDetailsForm";
import { TicketTypesEditor, type TypeStock } from "@/components/TicketTypesEditor";
import { SiteLookForm } from "@/components/SiteLookForm";
import { SetupOverview } from "@/components/settings/SetupOverview";
import { PaymentQrForm, PaymentRulesForm } from "@/components/settings/PaymentsForms";
import { OrderingForm } from "@/components/settings/OrderingForm";
import { AdvancedForm } from "@/components/settings/AdvancedForm";
import { LOCALE } from "@/config/site";
import { getActiveEvent, getAvailability, publicOrder } from "@/lib/queries";
import { getRules } from "@/lib/rules";
import { SITE_DEFAULTS, getSiteSettings, siteSettingsCustomised } from "@/lib/site-settings";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TicketTypeRow } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

/** One tab per job, so each screen shows only what that job needs. */
const TABS = [
  { id: "overview", label: "Overview", blurb: "What is set up and what is still missing." },
  { id: "event", label: "Event", blurb: "Name, date, venue, sales window, receipt and help link." },
  { id: "tickets", label: "Tickets", blurb: "Ticket types, prices, what each includes, and online cut-offs." },
  { id: "payments", label: "Payments", blurb: "QR codes, how long buyers have to pay, and how channels are named." },
  { id: "ordering", label: "Ordering", blurb: "Limits per order and the shirt sizes offered." },
  { id: "look", label: "Look", blurb: "Logo, artwork, slideshow, colours and the PDF ticket." },
  { id: "email", label: "Email", blurb: "The mailbox tickets and receipts are sent from." },
  { id: "advanced", label: "Advanced", blurb: "Staff login domain, drifter references, locale." },
] as const;
type TabId = (typeof TABS)[number]["id"];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const session = await requireSystem();
  const { tab: raw } = await searchParams;
  const tab: TabId = TABS.some((t) => t.id === raw) ? (raw as TabId) : "overview";
  const current = TABS.find((t) => t.id === tab)!;

  const [event, rules] = await Promise.all([getActiveEvent(), getRules()]);
  // Only the data the open tab needs.
  const needsTypes = tab === "overview" || tab === "tickets";
  const allTypes: TicketTypeRow[] = event && needsTypes
    ? ((await createAdminClient().from("ticket_types").select("*").eq("event_id", event.id).order("sort_order")).data ?? [])
    : [];
  const availability = event && needsTypes ? await getAvailability(event.id) : [];

  let body: React.ReactNode;
  switch (tab) {
    case "overview": {
      const [email, customised] = await Promise.all([getEmailSettings(), siteSettingsCustomised()]);
      body = (
        <SetupOverview
          event={event}
          types={allTypes}
          stock={availability}
          emailReady={email.provider !== "dry-run"}
          lookCustomised={customised}
          cronReady={!!process.env.CRON_SECRET}
        />
      );
      break;
    }
    case "event":
      body = event ? <EventDetailsForm event={event} /> : <NoEvent />;
      break;
    case "tickets": {
      // A label on another label's stack has no serials of its own (its code stays free to change).
      const codeOf = (id: string | null) => availability.find((x) => x.ticket_type_id === id)?.code;
      const stock: Record<string, TypeStock> = Object.fromEntries(availability.map((a) => [a.ticket_type_id, a.pool_type_id
        ? { pool_total: 0, sold: a.sold, shares: codeOf(a.pool_type_id) }
        : { pool_total: a.pool_total, sold: a.sold }]));
      const site = await getSiteSettings();
      body = event ? (
        <div className="space-y-6">
          <TicketTypesEditor types={allTypes} stock={stock} />
          <SalesScheduleForm types={publicOrder(allTypes.filter((t) => t.active && t.sell_online))} note={site.salesScheduleNote} />
        </div>
      ) : <NoEvent />;
      break;
    }
    case "payments":
      body = (
        <div className="space-y-6">
          {event ? <PaymentQrForm event={event} channels={rules.channels} /> : <NoEvent />}
          <PaymentRulesForm rules={rules} />
        </div>
      );
      break;
    case "ordering":
      body = <OrderingForm rules={rules} />;
      break;
    case "look": {
      const [site, customised] = await Promise.all([getSiteSettings(), siteSettingsCustomised()]);
      body = <SiteLookForm current={site} defaults={SITE_DEFAULTS} customised={customised} />;
      break;
    }
    case "email": {
      const s = await getEmailSettings();
      body = (
        <EmailSettingsForm
          defaultEmail={session.email ?? ""}
          current={{
            provider: s.provider,
            source: s.source,
            smtp_host: s.smtp_host,
            smtp_port: s.smtp_port,
            smtp_user: s.smtp_user,
            smtp_secure: s.smtp_secure,
            has_smtp_pass: !!s.smtp_pass,
            has_resend_key: !!s.resend_api_key,
            from: s.from,
          }}
        />
      );
      break;
    }
    case "advanced":
      body = <AdvancedForm rules={rules} locale={{ locale: LOCALE.locale, timeZone: LOCALE.timeZone, utcOffset: LOCALE.utcOffset, currency: LOCALE.currency }} />;
      break;
  }

  return (
    <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <aside className="min-w-0 lg:sticky lg:top-6 lg:self-start">
        <h1 className="mb-3 text-2xl font-bold">Settings</h1>
        {/* Rail on desktop, a scrollable strip on phones. Links, so each tab can be bookmarked. */}
        <nav aria-label="Settings sections" className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:overflow-visible lg:px-0">
          <ul className="flex gap-1 lg:flex-col">
            {TABS.map((t) => {
              const active = t.id === tab;
              return (
                <li key={t.id} className="shrink-0">
                  <Link
                    href={t.id === "overview" ? "/admin/settings" : `/admin/settings?tab=${t.id}`}
                    aria-current={active ? "page" : undefined}
                    className={`block rounded-xl px-3 py-2 text-sm transition lg:border-l-2 ${
                      active
                        ? "bg-white/10 font-semibold text-white lg:border-cyan-300"
                        : "text-zinc-400 hover:bg-white/5 hover:text-white lg:border-transparent"
                    }`}
                  >
                    {t.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>
      <main className="min-w-0 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">{current.label}</h2>
          <p className="text-sm text-zinc-500">{current.blurb}</p>
        </div>
        {body}
      </main>
    </div>
  );
}

function NoEvent() {
  return (
    <p className="card text-sm text-amber-300">
      No active event. Create one first with the new-event SQL template (SETUP-NEW-EVENT.md, step 3); its details then appear here.
    </p>
  );
}
