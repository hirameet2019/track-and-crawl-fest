"use client";

import { useEffect, useState, useTransition } from "react";
import { approveOrder, getProofUrl, rejectOrder } from "@/app/actions/admin";
import { php } from "@/lib/money";
import type { Attendee } from "@/lib/supabase/types";
import { SignedImage } from "@/components/SignedImage";
import { humanMinutes } from "@/lib/elapsed";

export interface QueueOrder {
  id: string;
  order_no: number;
  buyer_name: string;
  buyer_email: string | null;
  buyer_mobile: string | null;
  total_centavos: number;
  payment_method: string | null;
  payment_reference: string | null;
  payment_proof_path: string | null;
  proof_submitted_at: string | null;
  age_min: number | null;
  order_items: { qty: number; name: string; requires_vehicle: boolean; attendees: Attendee[] }[];
}

function ProofImage({ path, submittedAt }: { path: string | null; submittedAt: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (path) getProofUrl(path).then(setUrl);
  }, [path]);
  const when = submittedAt ? new Date(submittedAt).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }) : null;
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-white/10 bg-black/40">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Buyer&apos;s payment screenshot</div>
        {url && (
          <a href={url} target="_blank" rel="noreferrer" className="text-xs text-cyan-300 hover:underline">Open full size</a>
        )}
      </div>
      <div className="flex min-h-64 flex-1 items-center justify-center p-2">
        {!path ? (
          <div className="text-sm text-zinc-500">No screenshot was uploaded</div>
        ) : !url ? (
          <div className="h-60 w-full animate-pulse rounded-lg bg-white/5" />
        ) : (
          <a href={url} target="_blank" rel="noreferrer" title="Open full size" className="block w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="Payment screenshot uploaded by the buyer" className="mx-auto max-h-96 w-auto max-w-full rounded-lg object-contain" />
          </a>
        )}
      </div>
      <div className="border-t border-white/10 px-3 py-2 text-[11px] text-zinc-500">
        {when ? `Uploaded ${when}` : "Upload time unknown"} &middot; This is exactly what the buyer submitted. Compare it with the wallet history before approving.
      </div>
    </div>
  );
}

function Card({ o, onDone }: { o: QueueOrder; onDone: (id: string, warning?: string) => void }) {
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const age = o.age_min;

  return (
    <div className="card grid gap-4 lg:grid-cols-[1fr_1.2fr]">
      <ProofImage path={o.payment_proof_path} submittedAt={o.proof_submitted_at} />
      <div className="space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-lg font-bold">Order #{o.order_no}</div>
            <div className="text-sm">{o.buyer_name}</div>
            <div className="text-xs text-zinc-500">{o.buyer_email} &middot; {o.buyer_mobile}</div>
          </div>
          {age != null && <span className={`rounded-full px-2 py-0.5 text-xs ${age > 120 ? "bg-red-100 text-red-700" : "bg-zinc-100 text-zinc-600"}`}>{humanMinutes(age)} ago</span>}
        </div>
        <ul className="text-sm text-zinc-700">
          {o.order_items.map((i, k) => <li key={k}>{i.name} x {i.qty}</li>)}
        </ul>
        {o.order_items.some((i) => i.requires_vehicle) && (
          <div className="rounded-lg border border-white/10 bg-black/30 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Cars for display</div>
            <ul className="mt-2 space-y-2">
              {o.order_items.filter((i) => i.requires_vehicle).flatMap((i) => i.attendees.map((a, k) => (
                <li key={`${i.name}-${k}`} className="flex items-center gap-3 text-sm">
                  <SignedImage bucket="vehicle-photos" path={a.vehicle_photo_path} alt={`Car of ${a.holder_name ?? "attendee"}`} className="h-14 w-20 rounded-md object-cover" />
                  <div>
                    <div className="font-mono font-bold tracking-wide">{a.vehicle_plate ?? "-"}</div>
                    <div className="text-xs text-zinc-500">{a.vehicle_model ?? "-"} &middot; {a.holder_name ?? ""}</div>
                    {(() => {
                      const key = (p?: string | null) => (p ?? "").replace(/\s+/g, "").toUpperCase();
                      const riders = o.order_items.flatMap((x) => x.attendees).filter((c) => c.companion_of && key(c.companion_of) === key(a.vehicle_plate));
                      return riders.length ? (
                        <div className="mt-0.5 text-xs text-emerald-300">Companions: {riders.map((c) => `${c.holder_name ?? ""} (${c.shirt_size ?? "?"})`).join(", ")}</div>
                      ) : null;
                    })()}
                  </div>
                </li>
              )))}
            </ul>
          </div>
        )}
        <div className="rounded-lg bg-zinc-50 p-3 text-sm">
          <div className="flex justify-between"><span className="text-zinc-500">Expected amount</span><b className="text-lg">{php(o.total_centavos)}</b></div>
          <div className="flex justify-between"><span className="text-zinc-500">Method</span><b className="uppercase">{o.payment_method}</b></div>
          <div className="flex justify-between"><span className="text-zinc-500">Reference no.</span><b className="font-mono tracking-wide">{o.payment_reference}</b></div>
        </div>
        <p className="text-xs text-zinc-500">Check: the amount matches exactly, the reference number appears in the wallet history, and the date/time is plausible.</p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {!rejecting ? (
          <div className="flex gap-2">
            <button className="btn-success flex-1" disabled={pending} onClick={() => start(async () => { const r = await approveOrder(o.id); if (r.ok) onDone(o.id, r.warning); else setError(r.error); })}>
              {pending ? "Issuing tickets..." : "Approve & issue tickets"}
            </button>
            <button className="btn-danger" disabled={pending} onClick={() => setRejecting(true)}>Reject</button>
          </div>
        ) : (
          <div className="space-y-2">
            <input className="input" placeholder="Reason shown to the buyer, e.g. Amount paid was 150 instead of 300" value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="flex gap-2">
              <button className="btn-danger flex-1" disabled={pending} onClick={() => start(async () => { const r = await rejectOrder(o.id, reason); if (r.ok) onDone(o.id); else setError(r.error); })}>Confirm reject</button>
              <button className="btn-secondary" onClick={() => setRejecting(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function VerifyQueue({ orders }: { orders: QueueOrder[] }) {
  // Orders handled in this session disappear immediately; the server list refreshes on navigation.
  const [done, setDone] = useState<Set<string>>(() => new Set());
  const [warnings, setWarnings] = useState<string[]>([]);
  const list = orders.filter((o) => !done.has(o.id));
  const onDone = (id: string, warning?: string) => {
    setDone((s) => new Set(s).add(id));
    if (warning) setWarnings((w) => [...w, warning]);
  };
  return (
    <div className="space-y-4">
      {warnings.map((w, i) => <p key={i} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{w}</p>)}
      {list.length === 0 && <div className="card text-center text-zinc-500">Queue is empty. Nothing to verify.</div>}
      {list.length > 0 && <p className="text-sm text-zinc-500">{list.length} order{list.length === 1 ? "" : "s"} waiting, oldest first.</p>}
      {list.map((o) => <Card key={o.id} o={o} onDone={onDone} />)}
    </div>
  );
}
