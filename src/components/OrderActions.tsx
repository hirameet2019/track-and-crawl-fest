"use client";

import { LOCALE } from "@/config/site";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveOrder, cancelUnpaidOrder, getProofUrl, rejectOrder, resendTickets, settleOrderBalance, voidOrder } from "@/app/actions/admin";
import { ConvertOrderForm } from "@/components/ConvertOrderForm";
import { php } from "@/lib/money";
import type { OrderStatus } from "@/lib/supabase/types";
import { useRules } from "@/components/RulesProvider";

export function OrderActions({
  orderId, status, proofPath, hasEmail, isAdmin = false,
  buyerName = "", totalCentavos = 0, balanceCentavos = 0, balanceSettledAt = null, hasRedeemed = false, payApp,
}: {
  orderId: string; status: OrderStatus; proofPath: string | null; hasEmail: boolean; isAdmin?: boolean;
  buyerName?: string; totalCentavos?: number; balanceCentavos?: number; balanceSettledAt?: string | null; hasRedeemed?: boolean;
  /** Short name of the channel refunds and balances move through, e.g. "GoTyme". */
  payApp: string;
}) {
  const router = useRouter();
  const { terms: T } = useRules();
  const [msg, setMsg] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [settleNote, setSettleNote] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
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
      {status === "pending_payment" && (
        <div className="space-y-2 rounded-lg border border-zinc-300 p-3">
          <div className="text-xs font-semibold">Never paid? Cancel the order</div>
          <p className="text-xs text-zinc-500">No proof was uploaded. Cancelling puts the {T.many} back on sale. The buyer gets no email.</p>
          {!confirmCancel ? (
            <button className="btn-secondary w-full" disabled={pending} onClick={() => setConfirmCancel(true)}>Cancel unpaid order…</button>
          ) : (
            <div className="flex gap-2">
              <button className="btn-danger flex-1" disabled={pending} onClick={() => { setConfirmCancel(false); run(() => cancelUnpaidOrder(orderId), "Order cancelled"); }}>Yes, cancel it</button>
              <button className="btn-secondary flex-1" disabled={pending} onClick={() => setConfirmCancel(false)}>Keep it</button>
            </div>
          )}
        </div>
      )}
      {(status === "paid" || status === "voided") && (
        <a href={`/api/orders/${orderId}/pdf`} target="_blank" className="btn-secondary w-full">Open PDF</a>
      )}
      {status === "paid" && (
        <button className="btn-primary w-full" disabled={pending || !hasEmail} onClick={() => run(() => resendTickets(orderId), "Email re-sent")}>
          {hasEmail ? "Re-send ticket email" : "No email on order"}
        </button>
      )}
      {balanceCentavos !== 0 && (
        <div className={`space-y-2 rounded-lg border p-3 ${balanceSettledAt ? "border-emerald-500/30 bg-emerald-500/10" : "border-amber-500/40 bg-amber-500/10"}`}>
          <div className="text-xs font-semibold uppercase tracking-wide">
            {balanceCentavos > 0 ? "Refund due to the buyer" : "Still to collect from the buyer"}
          </div>
          <div className="text-xl font-black">{php(Math.abs(balanceCentavos))}</div>
          {balanceSettledAt ? (
            <p className="text-xs opacity-80">Marked settled on {new Date(balanceSettledAt).toLocaleString(LOCALE.locale, { timeZone: LOCALE.timeZone })}.</p>
          ) : isAdmin ? (
            <>
              <p className="text-xs opacity-80">Left over from a conversion. Move the money in {payApp} first, then record it here.</p>
              <input className="input" placeholder={`Reference or note, e.g. ${payApp} ref 123456`} value={settleNote} onChange={(e) => setSettleNote(e.target.value)} />
              <button className="btn-secondary w-full" disabled={pending} onClick={() => run(() => settleOrderBalance(orderId, settleNote), "Balance marked settled")}>
                Mark {balanceCentavos > 0 ? "refunded" : "collected"}
              </button>
            </>
          ) : (
            <p className="text-xs opacity-80">Left over from a conversion. An admin records it once the money has moved.</p>
          )}
        </div>
      )}
      {status === "paid" && isAdmin && (
        <ConvertOrderForm orderId={orderId} buyerName={buyerName} currentTotalCentavos={totalCentavos} hasRedeemed={hasRedeemed} />
      )}
      {status === "paid" && isAdmin && (
        <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3">
          <div className="text-xs font-semibold text-red-900">Approved by mistake? Void the whole order</div>
          <p className="text-xs text-red-900/80">Every unused ticket becomes invalid at the gate, the {T.one} numbers are retired, and the buyer gets an email with the reason. Tickets already scanned are kept. You can void single tickets from the table below instead, and any void can be undone.</p>
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
