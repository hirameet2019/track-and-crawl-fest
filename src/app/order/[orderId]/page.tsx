import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import QRCode from "qrcode";
import { OrderStatusBadge, TicketStatusBadge } from "@/components/StatusBadge";
import { EventBanner } from "@/components/EventHero";
import { getOrderBundle } from "@/lib/queries";
import { php } from "@/lib/money";
import { ticketUrl } from "@/lib/pdf/ticket-pdf";
import { createAdminClient } from "@/lib/supabase/admin";
import { SupportContact } from "@/components/SupportContact";
import { EXPIRED_GRACE_HOURS } from "@/config/event";

export const dynamic = "force-dynamic";

export default async function OrderStatusPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const b = await getOrderBundle(orderId);
  if (!b) notFound();
  const { order, event, items, tickets } = b;
  if (order.status === "pending_payment") redirect(`/pay/${orderId}`);

  const admin = createAdminClient();
  const [qrs, photos] = await Promise.all([
    Promise.all(tickets.map((t) => QRCode.toDataURL(ticketUrl(t.qr_token), { margin: 1, width: 320 }))),
    Promise.all(
      tickets.map(async (t) =>
        t.vehicle_photo_path
          ? (await admin.storage.from("vehicle-photos").createSignedUrl(t.vehicle_photo_path, 60 * 30)).data?.signedUrl ?? null
          : null,
      ),
    ),
  ]);

  return (
    <main className="flex-1">
    <EventBanner event={event} />
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">Order #{order.order_no}</h1>
        <OrderStatusBadge status={order.status} />
      </div>
      <p className="text-sm text-zinc-600">{order.buyer_name} &middot; {order.buyer_email}</p>

      {order.status === "awaiting_verification" && (
        <div className="card mt-6 border-blue-200 bg-blue-50">
          <h2 className="font-semibold text-blue-900">We received your proof of payment</h2>
          <p className="mt-1 text-sm text-blue-900">
            Reference {order.payment_reference} via {order.payment_method?.toUpperCase()}. A team member is now checking it against the account history.
            Your receipt and QR tickets will be emailed to <b>{order.buyer_email}</b> <b>within 24 hours</b>, usually much sooner.
            If it does not show up in your inbox, check your Spam or Junk folder and mark it as Not spam. Bookmark this page; it updates the moment your payment is confirmed.
          </p>
        </div>
      )}
      {order.status === "rejected" && (
        <div className="card mt-6 border-red-200 bg-red-50">
          <h2 className="font-semibold text-red-900">Payment could not be verified</h2>
          <p className="mt-1 text-sm text-red-900">Reason: {order.rejection_reason}</p>
          <p className="mt-2 text-sm text-red-900">Reply to the email we sent with your payment details, or <Link href="/" className="underline">place a new order</Link>.</p>
        </div>
      )}
      {order.status === "expired" && (
        <div className="card mt-6 border-zinc-300 bg-zinc-100">
          <h2 className="font-semibold">This order expired before payment was submitted</h2>
          <p className="mt-1 text-sm">
            <b>Already paid?</b> You can still <Link href={`/pay/${order.id}`} className="font-semibold underline">upload your proof here</Link> within {EXPIRED_GRACE_HOURS} hours of ordering and the order is restored while wristbands remain.
            Otherwise <Link href="/" className="underline">place a new order</Link>.
          </p>
          <p className="mt-1 text-xs text-zinc-600">Nakabayad na? I-upload pa rin ang proof sa link sa itaas. Kung hindi pa, mag-order ulit.</p>
        </div>
      )}

      {order.status !== "paid" && <SupportContact event={event} />}

      <div className="card mt-6">
        <h2 className="font-semibold">Summary</h2>
        <ul className="mt-2 divide-y text-sm">
          {items.map((it) => (
            <li key={it.id} className="flex justify-between py-2">
              <span>{it.ticket_type.name} x {it.qty}</span>
              <span>{php(it.qty * it.unit_price_centavos)}</span>
            </li>
          ))}
          <li className="flex justify-between py-2 font-bold"><span>Total</span><span>{php(order.total_centavos)}</span></li>
        </ul>
        {order.status === "paid" && (
          <a href={`/api/orders/${order.id}/pdf`} className="btn-primary mt-4 w-full sm:w-auto">Download receipt &amp; tickets (PDF)</a>
        )}
      </div>

      {order.status === "paid" && (
        <section className="mt-6">
          <h2 className="text-lg font-bold">Your tickets</h2>
          <p className="text-sm text-zinc-600">Show each QR code at the gate. Each one admits one person once.</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {tickets.map((t, i) => (
              <div key={t.id} className="card flex flex-col items-center text-center">
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{t.ticket_type.name}</div>
                <div className="text-3xl font-black">{t.number}</div>
                {t.ticket_type.band_color && <div className="text-xs text-zinc-500">{t.ticket_type.band_color} wristband</div>}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrs[i]} alt={`QR for ticket ${t.number}`} className="my-3 h-48 w-48" />
                <div className="text-sm font-medium">{t.holder_name}</div>
                <div className="text-xs text-zinc-500">
                  {t.shirt_size && <>Shirt {t.shirt_size} </>}
                  {t.vehicle_plate && <>&middot; {t.vehicle_plate} {t.vehicle_model}</>}
                  {t.companion_of && <>&middot; Companion of car {t.companion_of}</>}
                </div>
                {photos[i] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photos[i]!} alt={`Car ${t.vehicle_plate ?? ""}`} className="mt-2 h-24 w-36 rounded-lg border border-white/10 object-cover" />
                )}
                <div className="mt-2"><TicketStatusBadge status={t.status} /></div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
    </main>
  );
}
