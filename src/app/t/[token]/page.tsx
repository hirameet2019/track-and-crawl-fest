import { LOCALE } from "@/config/site";
import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { TicketStatusBadge } from "@/components/StatusBadge";
import { createAdminClient } from "@/lib/supabase/admin";
import { ticketUrl } from "@/lib/pdf/ticket-pdf";
import type { EventRow, TicketRow, TicketTypeRow } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

/**
 * Public single-ticket view, reached by scanning the QR with a normal camera app.
 * Shows the ticket; does NOT redeem. Staff redeem from /scan.
 */
export default async function TicketPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();
  const { data } = await admin
    .from("tickets")
    .select("*, ticket_type:ticket_types(*), order:orders(order_no, buyer_name, event:events(*))")
    .eq("qr_token", token)
    .maybeSingle();
  if (!data) notFound();
  const t = data as unknown as TicketRow & {
    ticket_type: TicketTypeRow;
    order: { order_no: number; buyer_name: string; event: EventRow };
  };
  const qr = await QRCode.toDataURL(ticketUrl(t.qr_token), { margin: 1, width: 320 });

  return (
    <main className="dark-zone flex-1 bg-brand"><div className="mx-auto w-full max-w-md px-4 py-10">
      <div className="card text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">{t.order.event.name}</p>
        <h1 className="display-title mt-2 text-2xl">{t.ticket_type.name}</h1>
        <div className="ticket-no mt-4 text-5xl">{t.number}</div>
        {t.ticket_type.band_color && <p className="text-xs text-zinc-500">{t.ticket_type.band_color} wristband</p>}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr} alt="Ticket QR" className="mx-auto my-5 h-56 w-56 rounded-2xl bg-white p-3" />
        <p className="font-medium">{t.holder_name ?? t.order.buyer_name}</p>
        <p className="text-sm text-zinc-500">Order #{t.order.order_no}</p>
        <div className="mt-3"><TicketStatusBadge status={t.status} /></div>
        {t.status === "void" && (
          <p className="mt-1 text-xs text-rose-300">Not valid for entry{t.void_reason ? `: ${t.void_reason}` : ""}. Contact the organizer with order #{t.order.order_no} if this is unexpected.</p>
        )}
        {t.status === "redeemed" && t.redeemed_at && (
          <p className="mt-1 text-xs text-zinc-500">Entered {new Date(t.redeemed_at).toLocaleString(LOCALE.locale, { timeZone: LOCALE.timeZone })}</p>
        )}
      </div>
      <p className="mt-4 text-center text-xs text-zinc-400">
        Staff: open the <Link href="/scan" className="underline">scanner</Link> to admit this ticket.
      </p>
    </div></main>
  );
}
