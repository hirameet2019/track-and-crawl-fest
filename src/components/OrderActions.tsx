"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveOrder, getProofUrl, rejectOrder, resendTickets } from "@/app/actions/admin";
import type { OrderStatus } from "@/lib/supabase/types";

export function OrderActions({ orderId, status, proofPath, hasEmail }: { orderId: string; status: OrderStatus; proofPath: string | null; hasEmail: boolean }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? okMsg : r.error ?? "Failed");
      if (r.ok) router.refresh();
    });

  return (
    <div className="mt-3 space-y-3 text-sm">
      {proofPath && (
        <button className="btn-secondary w-full" onClick={() => start(async () => { const u = await getProofUrl(proofPath); if (u) window.open(u, "_blank"); })}>
          Open payment screenshot
        </button>
      )}
      {(status === "awaiting_verification" || status === "pending_payment") && (
        <>
          <button className="btn-success w-full" disabled={pending} onClick={() => run(() => approveOrder(orderId), "Approved and tickets issued")}>Approve &amp; issue tickets</button>
          <div className="space-y-2">
            <input className="input" placeholder="Rejection reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            <button className="btn-danger w-full" disabled={pending} onClick={() => run(() => rejectOrder(orderId, reason), "Rejected")}>Reject</button>
          </div>
        </>
      )}
      {status === "paid" && (
        <>
          <a href={`/api/orders/${orderId}/pdf`} target="_blank" className="btn-secondary w-full">Open PDF</a>
          <button className="btn-primary w-full" disabled={pending || !hasEmail} onClick={() => run(() => resendTickets(orderId), "Email re-sent")}>
            {hasEmail ? "Re-send ticket email" : "No email on order"}
          </button>
        </>
      )}
      {msg && <p className="rounded bg-zinc-100 p-2 text-xs">{msg}</p>}
    </div>
  );
}
