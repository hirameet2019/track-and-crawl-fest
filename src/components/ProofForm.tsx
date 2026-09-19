"use client";

import { useState, useTransition } from "react";
import { submitPaymentProof } from "@/app/actions/orders";
import { PAYMENT_CHANNELS } from "@/config/event";
import { shrinkImage } from "@/lib/image";
import type { OnlinePaymentMethod } from "@/lib/supabase/types";

export function ProofForm({ orderId, methods }: { orderId: string; methods: OnlinePaymentMethod[] }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const single = methods.length === 1;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const raw = fd.get("screenshot");
      if (raw instanceof File && raw.size > 0) {
        const small = await shrinkImage(raw);
        if (small.size > 8 * 1024 * 1024) {
          setError("Screenshot is too large even after compression. Please crop it and try again.");
          return;
        }
        fd.set("screenshot", small);
      }
      const res = await submitPaymentProof(fd);
      if (res && !res.ok) setError(res.error);
    });
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-4">
      <input type="hidden" name="order_id" value={orderId} />
      <div>
        <label className="label">I paid with *</label>
        <div className="flex gap-3">
          {methods.map((m) => (
            <label key={m} className="flex flex-1 cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm has-[:checked]:border-zinc-900 has-[:checked]:bg-zinc-50">
              <input type="radio" name="payment_method" value={m} required defaultChecked={single} />
              {PAYMENT_CHANNELS[m].label}
            </label>
          ))}
        </div>
        {single && <p className="mt-1 text-xs text-zinc-500">Only {PAYMENT_CHANNELS[methods[0]].label} is accepted for now.</p>}
      </div>
      <div>
        <label className="label">Reference number *</label>
        <input name="payment_reference" className="input" autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="e.g. 20260918ABCD1234" required />
        <p className="mt-1 text-xs text-zinc-500">The reference / transaction number on your payment confirmation screen. Letters and digits, spaces are ignored.</p>
        <details className="mt-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2 text-xs">
          <summary className="cursor-pointer font-semibold text-zinc-700">Where do I find the reference number? <span className="font-normal text-zinc-500">Saan ito makikita?</span></summary>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/help/gotyme-reference.png" alt="Example confirmation screen with the reference number highlighted" className="mx-auto mt-2 w-full max-w-[260px] rounded-lg border border-zinc-200" />
          <p className="mt-2 text-zinc-600">
            Open your bank or e-wallet app, tap the transfer you just made, and copy the long number labelled <b>Reference No.</b>, <b>Transaction ID</b>, or <b>Trace No.</b> It is also on the confirmation screenshot.
            <br /><span className="text-zinc-500">Buksan ang app, hanapin ang transfer na ginawa mo, at kopyahin ang mahabang numero na Reference No. o Transaction ID.</span>
          </p>
        </details>
      </div>
      <div>
        <label className="label">Payment screenshot *</label>
        <input name="screenshot" type="file" accept="image/*" className="input" required />
        <p className="mt-1 text-xs text-zinc-500">The screenshot of your &quot;Transfer successful&quot; screen. Large screenshots are resized automatically. <span className="text-zinc-400">Screenshot ng confirmation ng bayad mo.</span></p>
      </div>
      {error && <p className="enter rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <button className="btn-primary w-full py-3" disabled={pending}>
        {pending ? "Uploading..." : "Submit proof of payment / I-submit ang proof"}
      </button>
    </form>
  );
}
