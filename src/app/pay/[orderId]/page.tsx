import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ProofForm } from "@/components/ProofForm";
import { EventBanner } from "@/components/EventHero";
import { Countdown } from "@/components/Countdown";
import { getOrderBundle } from "@/lib/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { php } from "@/lib/money";
import { PAYMENT_CHANNELS, PAYMENT_WINDOW_MINUTES } from "@/config/event";
import { SupportContact } from "@/components/SupportContact";
import type { OnlinePaymentMethod } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

export default async function PayPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  await createAdminClient().rpc("expire_stale_orders", {});
  const b = await getOrderBundle(orderId);
  if (!b) notFound();
  // Expiry is final: the wristbands are already back in the pool, so there is
  // nothing to pay for here. The order page explains what to do instead.
  if (b.order.status !== "pending_payment") redirect(`/order/${orderId}`);

  const { event, order, items } = b;
  // A channel is offered only when the organizer has set its QR image on the
  // events row. Right now that is GoTyme only; GCash / Maya come back the moment
  // their *_qr_url is filled in again, no deploy needed.
  const channels = (
    [
      { key: "gotyme", qr: event.gotyme_qr_url, name: event.gotyme_account_name },
      { key: "gcash", qr: event.gcash_qr_url, name: event.gcash_account_name },
      { key: "maya", qr: event.maya_qr_url, name: event.maya_account_name },
    ] as const
  ).filter((c): c is typeof c & { qr: string } => Boolean(c.qr));
  const methods: OnlinePaymentMethod[] = channels.length ? channels.map((c) => c.key) : ["gotyme"];

  return (
    <main className="flex-1">
    <EventBanner event={event} />
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold">Pay {php(order.total_centavos)}</h1>
      <p className="text-sm text-zinc-600">
        Order #{order.order_no} for {order.buyer_name}. Your wristbands are held for {PAYMENT_WINDOW_MINUTES} minutes, and{" "}
        {order.expires_at ? <Countdown until={order.expires_at} /> : "a limited time"} of that is left.
        {/* Expiry is final, so say so plainly while the buyer can still act on it. */}
        <span className="block text-xs font-semibold text-amber-800">
          Pay and upload before the timer ends. When it runs out the order is cancelled, the wristbands go back to the pool, and this
          page stops accepting payment.
        </span>
        <span className="block text-xs text-zinc-500">
          Naka-hold ang wristbands mo ng {PAYMENT_WINDOW_MINUTES} minuto. Bayaran at i-upload ang proof bago matapos ang oras. Pag naubos
          ito, kanselado na ang order at kailangan mo nang mag-order ulit.
        </span>
      </p>

      <div className="card mt-6">
        <h2 className="font-semibold">Order summary</h2>
        <ul className="mt-2 divide-y text-sm">
          {items.map((it) => (
            <li key={it.id} className="flex justify-between py-2">
              <span>{it.ticket_type.name} x {it.qty}</span>
              <span className="font-medium">{php(it.qty * it.unit_price_centavos)}</span>
            </li>
          ))}
          <li className="flex justify-between py-2 font-bold"><span>Total to pay</span><span>{php(order.total_centavos)}</span></li>
        </ul>
      </div>

      <section className="mt-6">
        <h2 className="text-lg font-bold">Step 1. Scan and pay the exact amount</h2>
        <p className="text-sm text-zinc-500">Open your GoTyme app (or any bank app with InstaPay QR), scan the code, and pay the exact amount. <span className="text-zinc-400">Buksan ang GoTyme app, i-scan ang QR, at bayaran ang eksaktong halaga.</span></p>
        <div className={`mt-3 grid gap-4 ${channels.length > 1 ? "sm:grid-cols-2" : "mx-auto max-w-sm"}`}>
          {channels.map((c) => {
            const ch = PAYMENT_CHANNELS[c.key];
            return (
              <div key={c.key} className="card text-center">
                <h3 className={`font-semibold ${ch.accent}`}>{ch.label}</h3>
                <Image src={c.qr} alt={`${ch.label} QR code`} width={320} height={320} className="mx-auto my-3 h-auto w-64 rounded-lg sm:w-72" unoptimized />
                {c.name && <p className="text-sm text-zinc-600">Account: <b>{c.name}</b></p>}
                {ch.hint && <p className="mt-1 text-xs text-zinc-500">{ch.hint}</p>}
              </div>
            );
          })}
        </div>
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Pay exactly <b>{php(order.total_centavos)}</b>. Put <b>Order #{order.order_no}</b> in the message or note if your app allows it. Take a screenshot of the confirmation.
          Any InstaPay transfer fee is charged by your own bank on top, so the amount received must still be the full ticket price.
          <span className="mt-1 block text-xs text-amber-800">Eksaktong <b>{php(order.total_centavos)}</b> ang ipadala. Pagkatapos magbayad, i-screenshot ang confirmation screen.</span>
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-bold">Step 2. Submit your proof of payment</h2>
        <p className="text-sm text-zinc-500">Type the reference number and upload the screenshot of your confirmation. <span className="text-zinc-400">Ilagay ang reference number at i-upload ang screenshot ng confirmation.</span></p>
        <div className="mt-3">
          <ProofForm orderId={order.id} methods={methods} />
        </div>
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">After you submit</div>
          <p className="mt-1">
            Every payment is checked by a real person against the account history, so your tickets are not instant.
            Please allow <b>up to 24 hours</b> for your receipt and QR tickets to arrive at <b>{order.buyer_email}</b>. Most are sent much sooner.
          </p>
          <p className="mt-2">
            If nothing arrives, look in your <b>Spam or Junk folder</b> first and mark the message as Not spam. You can also check your order any time at{" "}
            <Link href={`/order/${order.id}`} className="font-semibold underline">this status page</Link>; it updates the moment your payment is confirmed.
          </p>
          <p className="mt-2 text-xs text-amber-800">Pagkatapos i-submit, hintayin ang email na may receipt at QR tickets, hanggang 24 oras. Tingnan din ang Spam folder.</p>
        </div>
        <SupportContact event={event} />
      </section>
    </div>
    </main>
  );
}
