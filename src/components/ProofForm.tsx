"use client";

import { useState, useTransition } from "react";
import { submitPaymentProof } from "@/app/actions/orders";
import { shrinkImage } from "@/lib/image";

export function ProofForm({ orderId, methods }: { orderId: string; methods: ("gcash" | "maya")[] }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

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
              <input type="radio" name="payment_method" value={m} required defaultChecked={methods.length === 1} />
              {m === "gcash" ? "GCash" : "Maya"}
            </label>
          ))}
        </div>
      </div>
      <div>
        <label className="label">Reference number *</label>
        <input name="payment_reference" className="input" inputMode="numeric" placeholder="e.g. 1234567890123" required />
        <p className="mt-1 text-xs text-zinc-500">Found on your GCash or Maya payment confirmation screen.</p>
      </div>
      <div>
        <label className="label">Payment screenshot *</label>
        <input name="screenshot" type="file" accept="image/*" className="input" required />
        <p className="mt-1 text-xs text-zinc-500">Large screenshots are resized automatically before upload.</p>
      </div>
      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <button className="btn-primary w-full py-3" disabled={pending}>
        {pending ? "Uploading..." : "Submit proof of payment"}
      </button>
    </form>
  );
}
