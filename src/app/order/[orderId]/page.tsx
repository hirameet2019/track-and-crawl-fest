import { LOCALE } from "@/config/site";
import { vehicleWords } from "@/lib/vehicle";
import { notFound, redirect } from "next/navigation";
import QRCode from "qrcode";
import { OrderStatusBadge, TicketStatusBadge } from "@/components/StatusBadge";
import { EventBanner } from "@/components/EventHero";
import { getOrderBundle } from "@/lib/queries";
import { php } from "@/lib/money";
import { ticketUrl } from "@/lib/pdf/ticket-pdf";
import { createAdminClient } from "@/lib/supabase/admin";
import { SupportContact } from "@/components/SupportContact";

import { carNameOf, itemLabel } from "@/lib/items";
import { shirtShips } from "@/lib/shipping";
import { RichText } from "@/components/RichText";
import { regVars, siteText } from "@/lib/site-text";
import { paymentLabel } from "@/lib/payment-options";
import { getRules } from "@/lib/rules";

export const dynamic = "force-dynamic";

export default async function OrderStatusPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const [b, { terms: T, text }] = await Promise.all([getOrderBundle(orderId), getRules()]);
  const tx = siteText(text);
  const reg = regVars(T);
  if (!b) notFound();
  const { order, event, items } = b;
  const shipping = order.shipping;
  const settledOn = order.balance_settled_at ? new Date(order.balance_settled_at).toLocaleDateString(LOCALE.locale, { timeZone: LOCALE.timeZone, dateStyle: "medium" }) : null;
  // A ticket converted to another type handed its wristband back; it is no longer the
  // buyer's, so it is not listed here at all. Ordinary voids stay, marked VOID.
  const tickets = b.tickets.filter((t) => t.ticket_number_id !== null);
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
    <main className="flex-1 bg-brand dark-zone">
    <EventBanner event={event} />
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="display-title text-3xl sm:text-4xl">{tx("order.title", { no: order.order_no })}</h1>
        <OrderStatusBadge status={order.status} />
      </div>
      <p className="text-sm text-zinc-600">{order.buyer_name} &middot; {order.buyer_email}</p>

      {order.status === "awaiting_verification" && (
        <div className="card callout-info mt-6">
          <h2 className="font-semibold text-violet-100">{tx("order.verifyTitle")}</h2>
          <p className="mt-1 text-sm text-violet-100">
            <RichText text={tx("order.verifyText", { ref: order.payment_reference ?? "", channel: paymentLabel(order), email: order.buyer_email ?? "" })} />
          </p>
        </div>
      )}
      {order.status === "rejected" && (
        <div className="card callout-danger mt-6">
          <h2 className="font-semibold text-rose-100">{tx("order.rejectedTitle")}</h2>
          <p className="mt-1 text-sm text-rose-100">{tx("order.rejectedReason", { reason: order.rejection_reason ?? "" })}</p>
          <p className="mt-2 text-sm text-rose-100"><RichText text={tx("order.rejectedText")} /></p>
        </div>
      )}
      {order.status === "expired" && (
        <div className="card mt-6">
          <h2 className="font-semibold">{tx("order.expiredTitle")}</h2>
          <p className="mt-1 text-sm"><RichText text={tx("order.expiredText", reg)} /></p>
          {tx("order.expiredPaid") && <p className="mt-1 text-sm"><RichText text={tx("order.expiredPaid")} /></p>}
          {tx("order.expiredTl", reg) && <p className="mt-1 text-xs text-zinc-600">{tx("order.expiredTl", reg)}</p>}
        </div>
      )}

      {order.balance_centavos !== 0 && (
        <div className={`card mt-6 ${order.balance_centavos > 0 ? "callout-ok" : "callout-warn"}`}>
          <h2 className="font-semibold">{order.balance_centavos > 0 ? tx("order.refundTitle") : tx("order.balanceTitle")}</h2>
          <p className="mt-1 text-sm">
            {tx("order.changed")}{" "}
            <RichText
              text={order.balance_centavos > 0
                ? tx("order.refundText", { amount: php(order.balance_centavos), when: settledOn ? tx("order.refundSent", { date: settledOn }) : "" })
                : tx("order.balanceText", { amount: php(-order.balance_centavos), when: settledOn ? tx("order.balanceReceived", { date: settledOn }) : "" })}
            />
          </p>
          {!order.balance_settled_at && tx("order.balanceTl") && <p className="mt-1 text-xs opacity-80">{tx("order.balanceTl")}</p>}
        </div>
      )}

      {(order.status === "voided" || tickets.some((t) => t.status === "void")) && (
        <div className="card callout-danger mt-6">
          <h2 className="font-semibold text-rose-100">{order.status === "voided" ? tx("order.voidedTitle") : tx("order.someVoidedTitle")}</h2>
          <p className="mt-1 text-sm text-rose-100">
            <RichText text={tx("order.voidedText", { others: order.status === "voided" ? "" : tx("order.voidedOthers"), reason: tickets.find((t) => t.void_reason)?.void_reason ?? tx("order.voidedNoReason") })} />
          </p>
          {tx("order.voidedTl") && <p className="mt-1 text-xs text-rose-200/80">{tx("order.voidedTl")}</p>}
        </div>
      )}

      {order.status !== "paid" && <SupportContact event={event} />}

      <div className="card mt-6">
        <h2 className="holder-title">{tx("order.summary")}</h2>
        <ul className="mt-2 divide-y text-sm">
          {items.map((it) => (
            <li key={it.id} className="flex justify-between py-2">
              <span>{itemLabel(it, true, carNameOf(items))}</span>
              <span>{php(it.qty * it.unit_price_centavos)}</span>
            </li>
          ))}
          <li className="flex justify-between py-2 font-bold"><span>{tx("order.total")}</span><span>{php(order.total_centavos)}</span></li>
        </ul>
        {(order.status === "paid" || order.status === "voided") && (
          <a href={`/api/orders/${order.id}/pdf`} className="btn-primary mt-4 w-full sm:w-auto">{tx("order.pdf")}</a>
        )}
      </div>

      {shipping && (
        <div className="card mt-6 border-violet-400/30">
          <h2 className="holder-title">{tx("order.shirtDelivery")}</h2>
          <p className="mt-1 text-sm text-zinc-600">
            {shipping.name} · {shipping.mobile}<br />
            {shipping.address}<br />
            {shipping.city}, {shipping.province} {shipping.zip}<br />
            <span className="text-zinc-500">{tx("ship.via", { courier: shipping.courier })}</span>
          </p>
          <p className="mt-2 text-xs text-zinc-500">{tx("ship.note", { time: tx("form.shirtProcessing") })}</p>
          {tx("ship.noteTl") && <p className="mt-1 text-xs text-zinc-500">{tx("ship.noteTl")}</p>}
        </div>
      )}

      {(order.status === "paid" || order.status === "voided") && (
        <section className="mt-6">
          <h2 className="display-title text-2xl">{tx("order.yourTickets")}</h2>
          {tx("order.ticketsHint") && <p className="text-sm text-zinc-600">{tx("order.ticketsHint")}</p>}
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {tickets.map((t, i) => (
              <div key={t.id} className={`card flex flex-col items-center text-center ${t.status === "void" ? "opacity-60 grayscale" : ""}`}>
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{t.ticket_type.name}</div>
                <div className="ticket-no mt-1 text-3xl">{t.number}</div>
                {t.ticket_type.band_color && <div className="text-xs text-zinc-500">{t.ticket_type.band_color} {T.one}</div>}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {t.status === "void" ? (
                  <div className="my-3 flex h-48 w-48 items-center justify-center rounded-lg border-2 border-dashed border-rose-400/60 text-3xl font-black text-rose-400">VOID</div>
                ) : (
                  <img src={qrs[i]} alt={`QR for ticket ${t.number}`} className="my-3 h-48 w-48 rounded-xl bg-white p-2" />
                )}
                <div className="text-sm font-medium">{t.holder_name}</div>
                <div className="text-xs text-zinc-500">
                  {t.shirt_size && <>{tx(shirtShips(t.ticket_type, order) ? "order.shirtShips" : "order.shirt", { size: t.shirt_size })} </>}
                  {t.vehicle_plate && <>&middot; {t.vehicle_plate} {t.vehicle_model}</>}
                  {t.companion_of && <>&middot; {tx(t.included ? "order.passengerOf" : "order.companionOf", { plate: t.companion_of })}</>}
                </div>
                {photos[i] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photos[i]!} alt={`${vehicleWords(t.ticket_type).noun} ${t.vehicle_plate ?? ""}`} className="mt-2 h-24 w-36 rounded-lg border border-white/10 object-cover" />
                )}
                <div className="mt-2"><TicketStatusBadge status={t.status} /></div>
                {t.status === "void" && t.void_reason && <div className="mt-1 text-xs text-rose-300">{t.void_reason}</div>}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
    </main>
  );
}
