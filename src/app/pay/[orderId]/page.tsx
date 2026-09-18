import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ProofForm } from "@/components/ProofForm";
import { EventBanner } from "@/components/EventHero";
import { Countdown } from "@/components/Countdown";
import { getOrderBundle } from "@/lib/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { php } from "@/lib/money";
import { PAYMENT_CHANNELS } from "@/config/event";
import type { OnlinePaymentMethod } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

export default async function PayPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  await createAdminClient().rpc("expire_stale_orders", {});
  const b = await getOrderBundle(orderId);
  if (!b) notFound();
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
        Order #{order.order_no} for {order.buyer_name}. Your tickets are reserved for{" "}
        {order.expires_at ? <Countdown until={order.expires_at} /> : "a limited time"}.
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
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-bold">Step 2. Submit your proof of payment</h2>
        <div className="mt-3">
          <ProofForm orderId={order.id} methods={methods} />
        </div>
        <p className="mt-3 text-xs text-zinc-500">
          Our team verifies payments manually. Once confirmed, your receipt and tickets are sent to <b>{order.buyer_email}</b>. You can check the status any time at this link: <Link href={`/order/${order.id}`} className="underline">order status</Link>.
        </p>
      </section>
    </div>
    </main>
  );
}
