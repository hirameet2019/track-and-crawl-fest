import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ProofForm } from "@/components/ProofForm";
import { EventBanner } from "@/components/EventHero";
import { Countdown } from "@/components/Countdown";
import { RichText } from "@/components/RichText";
import { getOrderBundle } from "@/lib/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { php } from "@/lib/money";
import { primaryChannel } from "@/config/event";
import { getRules } from "@/lib/rules";
import { paymentOptions } from "@/lib/payment-options";
import { SupportContact } from "@/components/SupportContact";

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
  const rules = await getRules();
  const t = rules.payPage;
  const show = t.show;
  const pc = primaryChannel(event, rules.channels, rules.extraChannels);
  // Every channel switched on in Settings: built-ins with a QR, then added ones
  // with a QR or account number. None set up yet still shows GoTyme in the form.
  const options = paymentOptions(event, rules);
  const vars = {
    amount: php(order.total_centavos),
    order: order.order_no,
    name: order.buyer_name,
    email: order.buyer_email ?? "your email",
    minutes: rules.paymentWindowMinutes,
    app: pc.app,
    scanHint: pc.scanHint ? ` (${pc.scanHint})` : "",
  };
  const slots = {
    timeLeft: order.expires_at ? <Countdown until={order.expires_at} /> : "a limited time",
    statusLink: <Link href={`/order/${order.id}`} className="font-semibold underline">this status page</Link>,
  };
  const rich = (text: string) => <RichText text={text} vars={vars} slots={slots} />;

  return (
    <main className="flex-1 bg-brand dark-zone">
    <EventBanner event={event} />
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="display-title text-3xl sm:text-4xl"><span className="tabular">{rich(t.title)}</span></h1>
      {((show.holdNote && t.holdNote) || (show.holdWarning && (t.holdWarning || t.holdWarningTl))) && (
        <p className="mt-3 text-sm text-zinc-400">
          {show.holdNote && t.holdNote && rich(t.holdNote)}
          {/* Expiry is final, so say so plainly while the buyer can still act on it. */}
          {show.holdWarning && t.holdWarning && <span className="mt-2 block text-xs font-semibold text-amber-300">{rich(t.holdWarning)}</span>}
          {show.holdWarning && t.holdWarningTl && <span className="block text-xs text-zinc-500">{rich(t.holdWarningTl)}</span>}
        </p>
      )}

      {show.summary && (
        <div className="card mt-6">
          <h2 className="holder-title">{rich(t.summaryTitle)}</h2>
          <ul className="mt-2 divide-y text-sm">
            {items.map((it) => (
              <li key={it.id} className="flex justify-between py-2">
                <span>{it.ticket_type.name} x {it.qty}</span>
                <span className="font-medium">{php(it.qty * it.unit_price_centavos)}</span>
              </li>
            ))}
            <li className="flex justify-between py-2 font-bold"><span>{rich(t.totalLabel)}</span><span>{php(order.total_centavos)}</span></li>
          </ul>
        </div>
      )}

      <section className="mt-10">
        <h2 className="form-step"><span><span className="form-step-no">1</span> {rich(t.step1Title)}</span></h2>
        {(t.step1Text || t.step1TextTl) && (
          <p className="text-sm text-zinc-500">{rich(t.step1Text)}{t.step1Text && t.step1TextTl && " "}{t.step1TextTl && <span className="text-zinc-400">{rich(t.step1TextTl)}</span>}</p>
        )}
        <div className={`mt-3 grid gap-4 ${options.length > 1 ? "sm:grid-cols-2" : "mx-auto max-w-sm"}`}>
          {options.map((c) => (
            <div key={c.id} className="card text-center">
              <h3 className={`font-semibold ${c.accent}`}>{c.label}</h3>
              {c.qr && <Image src={c.qr} alt={`${c.label} QR code`} width={320} height={320} className="mx-auto my-3 h-auto w-64 rounded-lg sm:w-72" unoptimized />}
              {show.accountName && c.accountName && <p className="text-sm text-zinc-600">Account: <b>{c.accountName}</b></p>}
              {show.accountNumber && c.accountNumber && <p className="mt-1 text-sm text-zinc-600">Account no.: <b className="font-mono tracking-wide">{c.accountNumber}</b></p>}
              {c.hint && <p className="mt-1 text-xs text-zinc-500">{c.hint}</p>}
            </div>
          ))}
        </div>
        {show.exactCallout && (t.exactCallout || t.exactCalloutTl) && (
          <p className="callout callout-warn mt-3">
            {rich(t.exactCallout)}
            {t.exactCalloutTl && <span className="mt-1 block text-xs text-amber-200/80">{rich(t.exactCalloutTl)}</span>}
          </p>
        )}
      </section>

      <section className="mt-10">
        <h2 className="form-step"><span><span className="form-step-no">2</span> {rich(t.step2Title)}</span></h2>
        {(t.step2Text || t.step2TextTl) && (
          <p className="text-sm text-zinc-500">{rich(t.step2Text)}{t.step2Text && t.step2TextTl && " "}{t.step2TextTl && <span className="text-zinc-400">{rich(t.step2TextTl)}</span>}</p>
        )}
        <div className="mt-3">
          <ProofForm
            orderId={order.id}
            options={options.length ? options.map((o) => ({ id: o.id, label: o.label, app: o.app, referenceImage: o.referenceImage })) : [{ id: "gotyme", label: rules.channels.gotyme.label, app: rules.channels.gotyme.app, referenceImage: rules.channels.gotyme.referenceImage }]}
            vars={vars}
          />
        </div>
        {show.afterSubmit && (t.afterTitle || t.afterText || t.afterText2 || t.afterTextTl) && (
          <div className="callout callout-info mt-4">
            {t.afterTitle && <div className="font-semibold text-white">{rich(t.afterTitle)}</div>}
            {t.afterText && <p className="mt-1">{rich(t.afterText)}</p>}
            {t.afterText2 && <p className="mt-2">{rich(t.afterText2)}</p>}
            {t.afterTextTl && <p className="mt-2 text-xs text-violet-200/80">{rich(t.afterTextTl)}</p>}
          </div>
        )}
        {show.support && <SupportContact event={event} />}
      </section>
    </div>
    </main>
  );
}
