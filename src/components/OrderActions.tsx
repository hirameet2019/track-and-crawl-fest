"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveOrder, getProofUrl, rejectOrder, resendTickets, voidOrder } from "@/app/actions/admin";
import type { OrderStatus } from "@/lib/supabase/types";

export function OrderActions({ orderId, status, proofPath, hasEmail, isAdmin = false }: { orderId: string; status: OrderStatus; proofPath: string | null; hasEmail: boolean; isAdmin?: boolean }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string; warning?: string }>, okMsg: string) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? r.warning ?? okMsg : r.error ?? "Failed");
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
      {(status === "paid" || status === "voided") && (
        <a href={`/api/orders/${orderId}/pdf`} target="_blank" className="btn-secondary w-full">Open PDF</a>
      )}
      {status === "paid" && (
        <button className="btn-primary w-full" disabled={pending || !hasEmail} onClick={() => run(() => resendTickets(orderId), "Email re-sent")}>
          {hasEmail ? "Re-send ticket email" : "No email on order"}
        </button>
      )}
      {status === "paid" && isAdmin && (
        <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3">
          <div className="text-xs font-semibold text-red-900">Approved by mistake? Void the whole order</div>
          <p className="text-xs text-red-900/80">Every unused ticket becomes invalid at the gate, the wristband numbers are retired, and the buyer gets an email with the reason. Tickets already scanned are kept. You can void single tickets from the table below instead, and any void can be undone.</p>
          <input className="input" placeholder="Reason the buyer will see, e.g. Payment amount did not match" value={voidReason} onChange={(e) => { setVoidReason(e.target.value); setConfirmVoid(false); }} />
          {!confirmVoid ? (
            <button className="btn-danger w-full" disabled={pending || voidReason.trim().length < 3} onClick={() => setConfirmVoid(true)}>Void all tickets in this order…</button>
          ) : (
            <div className="flex gap-2">
              <button className="btn-danger flex-1" disabled={pending} onClick={() => { setConfirmVoid(false); run(() => voidOrder(orderId, voidReason), "Order voided and buyer notified"); }}>Yes, void the order</button>
              <button className="btn-secondary flex-1" disabled={pending} onClick={() => setConfirmVoid(false)}>Cancel</button>
            </div>
          )}
        </div>
      )}
      {status === "voided" && <p className="rounded bg-red-50 p-2 text-xs text-red-900">All tickets in this order are void. Restore a ticket from the table below if this was a mistake; the order becomes Paid again.</p>}
      {msg && <p className="rounded bg-zinc-100 p-2 text-xs">{msg}</p>}
    </div>
  );
}
