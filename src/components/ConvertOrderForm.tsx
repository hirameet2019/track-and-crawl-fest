"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { convertOrder, getConvertTargets, type ConvertTarget } from "@/app/actions/admin";
import { php } from "@/lib/money";
import { BandSwatch } from "@/components/BandSwatch";

/**
 * Swap a paid order to a different ticket type without losing the order number,
 * the receipt or the payment trail. Used when a buyer changes their mind after
 * paying - the alternative is voiding and making them order again.
 */
export function ConvertOrderForm({
  orderId,
  buyerName,
  currentTotalCentavos,
  hasRedeemed,
}: {
  orderId: string;
  buyerName: string;
  currentTotalCentavos: number;
  hasRedeemed: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<ConvertTarget[] | null>(null);
  const [typeId, setTypeId] = useState("");
  const [qty, setQty] = useState(1);
  const [reason, setReason] = useState("");
  const [names, setNames] = useState<{ holder_name: string; shirt_size: string }[]>([]);
  const [showNames, setShowNames] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open || targets) return;
    let live = true;
    getConvertTargets(orderId).then((t) => { if (live) setTargets(t); });
    return () => { live = false; };
  }, [open, targets, orderId]);

  const target = targets?.find((t) => t.id === typeId) ?? null;
  const newTotal = target ? target.price_centavos * qty : 0;
  const balance = currentTotalCentavos - newTotal;
  /** How many of the chosen ticket the money already paid would cover exactly. */
  const fits = target && target.price_centavos > 0 ? Math.floor(currentTotalCentavos / target.price_centavos) : 0;
  const tooMany = target ? qty > target.sellable : false;

  const nameAt = (i: number) => names[i] ?? { holder_name: "", shirt_size: "" };
  const setNameAt = (i: number, patch: Partial<{ holder_name: string; shirt_size: string }>) =>
    setNames((prev) => {
      const next = [...prev];
      while (next.length <= i) next.push({ holder_name: "", shirt_size: "" });
      next[i] = { ...next[i], ...patch };
      return next;
    });

  if (hasRedeemed) {
    return (
      <p className="rounded-lg border border-zinc-300 bg-zinc-50 p-3 text-xs text-zinc-700">
        A ticket in this order was already scanned at the gate, so it can no longer be converted.
      </p>
    );
  }

  if (!open) {
    return (
      <div className="space-y-2">
        <button type="button" className="btn-secondary w-full" onClick={() => setOpen(true)}>
          Change to another ticket&hellip;
        </button>
        {msg && <p className="rounded bg-zinc-100 p-2 text-xs text-zinc-900">{msg}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-cyan-300/40 bg-cyan-300/5 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Convert this order</div>
          <p className="mt-1 text-xs text-zinc-400">
            Keeps order number and receipt. The old wristbands go back to the pool, new ones are issued, and the
            buyer gets one email with the new PDF. Any difference in price is left as a balance to settle by hand.
          </p>
        </div>
        <button type="button" className="text-xs text-zinc-400 hover:text-zinc-200" onClick={() => setOpen(false)}>Close</button>
      </div>

      {targets === null ? (
        <p className="text-xs text-zinc-500">Loading ticket types&hellip;</p>
      ) : (
        <>
          <div>
            <label className="label" htmlFor={`convert-type-${orderId}`}>New ticket</label>
            <select
              id={`convert-type-${orderId}`}
              className="input mt-1"
              value={typeId}
              onChange={(e) => { setTypeId(e.target.value); setConfirm(false); }}
            >
              <option value="">Choose a ticket type&hellip;</option>
              {targets.map((t) => (
                <option key={t.id} value={t.id} disabled={t.sellable <= 0}>
                  {t.name} - {php(t.price_centavos)} ({t.sellable} left)
                </option>
              ))}
            </select>
            {target && (
              <p className="mt-1 flex items-center gap-2 text-xs text-zinc-400">
                <BandSwatch color={target.band_color} size={10} label={false} /> {target.band_color} wristband
                {fits > 0 && <> &middot; {php(currentTotalCentavos)} covers <b>{fits}</b> of these</>}
              </p>
            )}
            {target?.drifter_family && (
              <p className="mt-1 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-200">
                Paid for through this order, so it does <b>not</b> use up that drifter&apos;s four free bands. Hand-outs
                recorded on the Drifters tab are the only ones counted there.
              </p>
            )}
          </div>

          <div>
            <label className="label" htmlFor={`convert-qty-${orderId}`}>How many</label>
            <div className="mt-1 flex items-center gap-2">
              <button type="button" className="btn-secondary h-10 w-10 text-lg font-black" disabled={qty <= 1} onClick={() => { setQty((q) => Math.max(1, q - 1)); setConfirm(false); }} aria-label="One less">&minus;</button>
              <input
                id={`convert-qty-${orderId}`}
                className="input w-20 text-center"
                inputMode="numeric"
                value={qty}
                onChange={(e) => { setQty(Math.min(50, Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1))); setConfirm(false); }}
              />
              <button type="button" className="btn-secondary h-10 w-10 text-lg font-black" disabled={qty >= 50} onClick={() => { setQty((q) => Math.min(50, q + 1)); setConfirm(false); }} aria-label="One more">+</button>
              {fits > 1 && fits !== qty && (
                <button type="button" className="text-xs text-cyan-300 hover:underline" onClick={() => { setQty(Math.min(50, fits)); setConfirm(false); }}>
                  use all {php(currentTotalCentavos)} ({fits})
                </button>
              )}
            </div>
            {tooMany && <p className="mt-1 text-xs text-rose-400">Only {target?.sellable} left for that label.</p>}
          </div>

          {target && (
            <dl className="grid grid-cols-3 gap-2 rounded-lg bg-black/30 p-2 text-center text-xs">
              <div><dt className="text-zinc-500">Paid</dt><dd className="text-sm font-bold">{php(currentTotalCentavos)}</dd></div>
              <div><dt className="text-zinc-500">New total</dt><dd className="text-sm font-bold">{php(newTotal)}</dd></div>
              <div>
                <dt className="text-zinc-500">{balance >= 0 ? "To refund" : "To collect"}</dt>
                <dd className={`text-sm font-bold ${balance > 0 ? "text-amber-300" : balance < 0 ? "text-rose-400" : ""}`}>{php(Math.abs(balance))}</dd>
              </div>
            </dl>
          )}

          {target && (
            <div>
              <button type="button" className="text-xs text-cyan-300 hover:underline" onClick={() => setShowNames((v) => !v)}>
                {showNames ? "Hide names" : `Names${target.includes_shirt ? " and shirt sizes" : ""} (optional)`}
              </button>
              {showNames && (
                <div className="mt-2 space-y-2">
                  <p className="text-xs text-zinc-500">Left blank, every ticket is issued to <b>{buyerName}</b>.</p>
                  {Array.from({ length: qty }, (_, i) => (
                    <div key={i} className="flex gap-2">
                      <input
                        className="input flex-1 py-1 text-sm"
                        placeholder={`Ticket ${i + 1} holder - ${buyerName}`}
                        value={nameAt(i).holder_name}
                        onChange={(e) => setNameAt(i, { holder_name: e.target.value })}
                        aria-label={`Holder name for ticket ${i + 1}`}
                      />
                      {target.includes_shirt && (
                        <input
                          className="input w-20 py-1 text-sm"
                          placeholder="Shirt"
                          value={nameAt(i).shirt_size}
                          onChange={(e) => setNameAt(i, { shirt_size: e.target.value })}
                          aria-label={`Shirt size for ticket ${i + 1}`}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div>
            <label className="label" htmlFor={`convert-reason-${orderId}`}>Reason the buyer will see</label>
            <input
              id={`convert-reason-${orderId}`}
              className="input mt-1"
              placeholder="e.g. Changed from car display to Early Bird at the buyer's request"
              value={reason}
              onChange={(e) => { setReason(e.target.value); setConfirm(false); }}
            />
          </div>

          {!confirm ? (
            <button
              type="button"
              className="btn-primary w-full"
              disabled={pending || !target || tooMany || reason.trim().length < 3}
              onClick={() => setConfirm(true)}
            >
              {target ? <>Convert to {qty} &times; {target.name}&hellip;</> : <>Choose a ticket type first</>}
            </button>
          ) : (
            <div className="space-y-2">
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-200">
                The wristband numbers on this order stop working immediately and the buyer is emailed.
                {balance > 0 && <> You will still owe them <b>{php(balance)}</b>.</>}
                {balance < 0 && <> They will still owe <b>{php(-balance)}</b>.</>}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-primary flex-1"
                  disabled={pending}
                  onClick={() => {
                    setConfirm(false);
                    start(async () => {
                      const r = await convertOrder({
                        orderId,
                        ticketTypeId: typeId,
                        qty,
                        reason,
                        attendees: names.slice(0, qty).map((n) => ({
                          holder_name: n.holder_name.trim() || undefined,
                          shirt_size: n.shirt_size.trim() || undefined,
                        })),
                      });
                      setMsg(r.ok ? r.warning ?? r.summary ?? "Converted" : r.error);
                      if (r.ok) { setOpen(false); setNames([]); setReason(""); router.refresh(); }
                    });
                  }}
                >
                  {pending ? "Converting…" : "Yes, convert"}
                </button>
                <button type="button" className="btn-secondary flex-1" disabled={pending} onClick={() => setConfirm(false)}>Cancel</button>
              </div>
            </div>
          )}
        </>
      )}

      {msg && <p className="rounded bg-zinc-100 p-2 text-xs text-zinc-900">{msg}</p>}
    </div>
  );
}
