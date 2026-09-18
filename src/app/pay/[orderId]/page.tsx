import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ProofForm } from "@/components/ProofForm";
import { EventBanner } from "@/components/EventHero";
import { Countdown } from "@/components/Countdown";
import { getOrderBundle } from "@/lib/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { php } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function PayPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  await createAdminClient().rpc("expire_stale_orders", {});
  const b = await getOrderBundle(orderId);
  if (!b) notFound();
  if (b.order.status !== "pending_payment") redirect(`/order/${orderId}`);

  const { event, order, items } = b;
  const methods = (["gcash", "maya"] as const).filter((m) => (m === "gcash" ? event.gcash_qr_url : event.maya_qr_url));

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
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {event.gcash_qr_url && (
            <div className="card text-center">
              <h3 className="font-semibold text-sky-700">GCash</h3>
              <Image src={event.gcash_qr_url} alt="GCash QR code" width={260} height={260} className="mx-auto my-3 rounded-lg" unoptimized />
              {event.gcash_account_name && <p className="text-sm text-zinc-600">Account: <b>{event.gcash_account_name}</b></p>}
            </div>
          )}
          {event.maya_qr_url && (
            <div className="card text-center">
              <h3 className="font-semibold text-emerald-700">Maya</h3>
              <Image src={event.maya_qr_url} alt="Maya QR code" width={260} height={260} className="mx-auto my-3 rounded-lg" unoptimized />
              {event.maya_account_name && <p className="text-sm text-zinc-600">Account: <b>{event.maya_account_name}</b></p>}
            </div>
          )}
        </div>
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Pay exactly <b>{php(order.total_centavos)}</b>. Put <b>Order #{order.order_no}</b> in the message or note if your app allows it. Take a screenshot of the confirmation.
        </p>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-bold">Step 2. Submit your proof of payment</h2>
        <div className="mt-3">
          <ProofForm orderId={order.id} methods={methods.length ? [...methods] : ["gcash", "maya"]} />
        </div>
        <p className="mt-3 text-xs text-zinc-500">
          Our team verifies payments manually. Once confirmed, your receipt and tickets are sent to <b>{order.buyer_email}</b>. You can check the status any time at this link: <Link href={`/order/${order.id}`} className="underline">order status</Link>.
        </p>
      </section>
    </div>
    </main>
  );
}
