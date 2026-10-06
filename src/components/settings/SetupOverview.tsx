import Link from "next/link";
import { SITE_URL } from "@/config/event";
import { isSalesOpen } from "@/lib/queries";
import { fmtCutoff } from "@/lib/cutoff";
import type { AvailabilityRow, EventRow, TicketTypeRow } from "@/lib/supabase/types";

type Status = "done" | "todo" | "info";
interface Item {
  status: Status;
  title: string;
  detail: string;
  href?: string;
  action?: string;
}

const MARK: Record<Status, { label: string; cls: string }> = {
  done: { label: "Ready", cls: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300" },
  todo: { label: "To do", cls: "border-amber-400/40 bg-amber-400/10 text-amber-300" },
  info: { label: "Note", cls: "border-white/15 bg-white/5 text-zinc-400" },
};

/**
 * Admin > Settings > Overview: what a new event still needs before sales open,
 * each item linking to the tab that fixes it. Read-only; computed per request.
 */
export function SetupOverview({
  event,
  types,
  stock,
  emailReady,
  lookCustomised,
  cronReady,
}: {
  event: EventRow | null;
  types: TicketTypeRow[];
  stock: AvailabilityRow[];
  emailReady: boolean;
  lookCustomised: boolean;
  cronReady: boolean;
}) {
  const active = types.filter((t) => t.active);
  const online = active.filter((t) => t.sell_online);
  const banded = new Map(stock.map((a) => [a.ticket_type_id, a.pool_total]));
  const noBands = active.filter((t) => (t.sell_online || t.sell_at_gate) && !banded.get(t.id));
  const hasQr = !!(event?.gotyme_qr_url || event?.gcash_qr_url || event?.maya_qr_url);
  const localUrl = /localhost|127\.0\.0\.1/.test(SITE_URL);

  const items: Item[] = event
    ? [
        {
          status: event.starts_at && event.venue ? "done" : "todo",
          title: "Event name, date and venue",
          detail: event.starts_at && event.venue ? `${event.name}, ${event.venue}` : "Add the date and venue buyers see on the sales page.",
          href: "?tab=event",
          action: "Event",
        },
        {
          status: hasQr ? "done" : "todo",
          title: "Payment QR code",
          detail: hasQr ? "Buyers have a way to pay." : "Upload at least one QR, or buyers cannot pay.",
          href: "?tab=payments",
          action: "Payments",
        },
        {
          status: online.length ? "done" : "todo",
          title: "Tickets sold online",
          detail: online.length ? `${online.length} type${online.length === 1 ? "" : "s"} on the sales page.` : "Add at least one ticket type sold online.",
          href: "?tab=tickets",
          action: "Tickets",
        },
        {
          status: noBands.length ? "todo" : "done",
          title: "Wristband serials loaded",
          detail: noBands.length ? `No bands yet for ${noBands.map((t) => t.name).join(", ")}.` : "Every type on sale has bands in the pool.",
          href: "/admin/numbers",
          action: "Numbers",
        },
        {
          status: event.support_contact_url ? "done" : "todo",
          title: "“Need help?” link",
          detail: event.support_contact_url ? event.support_contact_label ?? event.support_contact_url : "Buyers whose hold expired are sent here; set it while sales are open.",
          href: "?tab=event",
          action: "Event",
        },
        {
          status: emailReady ? "done" : "todo",
          title: "Email sending",
          detail: emailReady ? "Tickets and receipts go out by email." : "Not configured: emails are only logged, nobody receives tickets.",
          href: "?tab=email",
          action: "Email",
        },
        {
          status: cronReady ? "done" : "todo",
          title: "Reminder and expiry emails",
          detail: cronReady ? "The 5-minute job is allowed to run." : "CRON_SECRET is not set on the server, so the reminder job refuses to run. A developer sets it in Vercel.",
        },
        {
          status: localUrl ? "todo" : "done",
          title: "Public site address",
          detail: localUrl ? `QR codes and email links point to ${SITE_URL}. Set NEXT_PUBLIC_SITE_URL to the real domain.` : `QR codes and links point to ${SITE_URL}.`,
        },
        {
          status: "info",
          title: "Sales",
          detail: isSalesOpen(event)
            ? event.sales_close_at ? `Open until ${fmtCutoff(event.sales_close_at)}.` : "Open, no overall closing date."
            : "Closed right now (see the sales window in Event).",
          href: "?tab=event",
          action: "Event",
        },
        {
          status: "info",
          title: "Look of the site",
          detail: lookCustomised ? "Using your saved logo, artwork and colours." : "Still the built-in Meet & Drift 3 look.",
          href: "?tab=look",
          action: "Look",
        },
      ]
    : [];

  const required = items.filter((i) => i.status !== "info");
  const ready = required.filter((i) => i.status === "done").length;

  return (
    <div className="card space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-semibold">Setup checklist</h2>
          <p className="text-sm text-zinc-500">What this event needs before buyers can pay and get their tickets.</p>
        </div>
        {event && (
          <p className="text-sm">
            <b className={ready === required.length ? "text-emerald-300" : "text-amber-300"}>{ready} of {required.length}</b>
            <span className="text-zinc-500"> ready</span>
          </p>
        )}
      </div>
      {!event ? (
        <p className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-4 text-sm text-amber-200">
          No active event yet. Run the new-event SQL template once (SETUP-NEW-EVENT.md, step 3); everything else is set up here.
        </p>
      ) : (
        <ul className="divide-y divide-white/10">
          {items.map((i) => (
            <li key={i.title} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-3">
              <span className={`mt-0.5 w-14 shrink-0 rounded-full border px-2 py-0.5 text-center text-[11px] font-semibold ${MARK[i.status].cls}`}>{MARK[i.status].label}</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-zinc-100">{i.title}</div>
                <div className="text-xs text-zinc-400">{i.detail}</div>
              </div>
              {i.href && (
                <Link href={i.href} className="btn-secondary shrink-0 px-3 py-1 text-xs">{i.action}</Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
