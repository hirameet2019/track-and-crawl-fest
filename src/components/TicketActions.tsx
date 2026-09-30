"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { unredeemTicket, unvoidTicket, voidTicket } from "@/app/actions/admin";
import type { TicketStatus } from "@/lib/supabase/types";

/**
 * Void / restore controls for one issued ticket on the admin order page.
 * Admin only (the server action enforces it too). Void asks for a reason the
 * buyer will read in the notice email; restore re-sends the ticket PDF.
 */
export function TicketActions({ ticketId, number, status, voidReason }: { ticketId: string; number: string; status: TicketStatus; voidReason: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string; warning?: string }>, okMsg: string) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? r.warning ?? okMsg : r.error ?? "Failed");
      if (r.ok) { setOpen(false); setReason(""); router.refresh(); }
    });

  // A mis-scan at the gate (wrong band, wrong person's phone) would otherwise
  // leave the real holder locked out, so the scan can be undone with a reason.
  if (status === "redeemed") {
    return (
      <div className="space-y-1 text-xs">
        <div className="text-zinc-400">Used at gate</div>
        {!open ? (
          <button className="underline" onClick={() => setOpen(true)}>Undo scan…</button>
        ) : (
          <div className="flex min-w-[16rem] flex-col gap-1">
            <input className="input py-1 text-xs" autoFocus placeholder={`Why undo the scan of ${number}?`} value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="flex gap-1">
              <button className="btn-primary flex-1 py-1 text-xs" disabled={pending || reason.trim().length < 3} onClick={() => run(() => unredeemTicket(ticketId, reason), `${number} can be scanned again`)}>Undo scan</button>
              <button className="btn-secondary flex-1 py-1 text-xs" disabled={pending} onClick={() => { setOpen(false); setReason(""); }}>Cancel</button>
            </div>
          </div>
        )}
        {msg && <div className="text-zinc-500">{msg}</div>}
      </div>
    );
  }

  if (status === "void") {
    return (
      <div className="space-y-1 text-xs">
        {voidReason && <div className="max-w-[16rem] text-red-700">Void: {voidReason}</div>}
        <button className="underline" disabled={pending} onClick={() => run(() => unvoidTicket(ticketId), `${number} restored and ticket email re-sent`)}>Restore ticket</button>
        {msg && <div className="text-zinc-500">{msg}</div>}
      </div>
    );
  }

  return (
    <div className="space-y-1 text-xs">
      {!open ? (
        <button className="text-red-700 underline" onClick={() => setOpen(true)}>Void…</button>
      ) : (
        <div className="flex min-w-[16rem] flex-col gap-1">
          <input className="input py-1 text-xs" autoFocus placeholder={`Why void ${number}? Buyer will see this`} value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex gap-1">
            <button className="btn-danger flex-1 py-1 text-xs" disabled={pending || reason.trim().length < 3} onClick={() => run(() => voidTicket(ticketId, reason), `${number} voided, buyer notified`)}>Void {number}</button>
            <button className="btn-secondary flex-1 py-1 text-xs" disabled={pending} onClick={() => { setOpen(false); setReason(""); }}>Cancel</button>
          </div>
        </div>
      )}
      {msg && <div className="text-zinc-500">{msg}</div>}
    </div>
  );
}
