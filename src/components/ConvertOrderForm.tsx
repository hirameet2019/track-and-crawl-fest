"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { convertOrder, getConvertTargets, type ConvertContext } from "@/app/actions/admin";
import { php } from "@/lib/money";
import { BandSwatch } from "@/components/BandSwatch";
import { useRules } from "@/components/RulesProvider";
import { COURIERS, type Courier, type Shipping } from "@/lib/shipping";

type Row = { holder_name: string; shirt_size: string; vehicle_plate: string; vehicle_model: string; passengers: string[] };
const blankRow = (): Row => ({ holder_name: "", shirt_size: "", vehicle_plate: "", vehicle_model: "", passengers: [] });
const blankShipping = (buyerName: string): Shipping => ({ name: buyerName, mobile: "", address: "", city: "", province: "", zip: "", courier: "LBC" });

/**
 * Swap a paid order to a different ticket type without losing the order number,
 * the receipt or the payment trail. Used when a buyer changes their mind after
 * paying - the alternative is voiding and making them order again.
 *
 * Car labels ask for each car's plate and model and its free passengers' names;
 * labels whose shirt ships ask where to deliver it, unless the order already has
 * an address. Everything is checked again on the server.
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
  const sizes = useRules().shirtChart.map((r) => r.size);
  const [open, setOpen] = useState(false);
  const [ctx, setCtx] = useState<ConvertContext | null>(null);
  const [typeId, setTypeId] = useState("");
  const [qty, setQty] = useState(1);
  const [reason, setReason] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [showNames, setShowNames] = useState(false);
  const [shipping, setShipping] = useState<Shipping | null>(null);
  const [editShipping, setEditShipping] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open || ctx) return;
    let live = true;
    getConvertTargets(orderId).then((c) => {
      if (!live) return;
      setCtx(c);
      setShipping(c.shipping);
    });
    return () => { live = false; };
  }, [open, ctx, orderId]);

  const targets = ctx?.targets ?? null;
  const target = targets?.find((t) => t.id === typeId) ?? null;
  const isCar = !!target?.requires_vehicle;
  const passengers = target?.included_companions ?? 0;
  const needsAddress = !!target?.ships_shirt;
  const newTotal = target ? target.price_centavos * qty : 0;
  const balance = currentTotalCentavos - newTotal;
  /** How many of the chosen ticket the money already paid would cover exactly. */
  const fits = target && target.price_centavos > 0 ? Math.floor(currentTotalCentavos / target.price_centavos) : 0;
  const tooMany = target ? qty > target.sellable : false;

  const rowAt = (i: number) => rows[i] ?? blankRow();
  const setRowAt = (i: number, patch: Partial<Row>) =>
    setRows((prev) => {
      const next = [...prev];
      while (next.length <= i) next.push(blankRow());
      next[i] = { ...next[i], ...patch };
      return next;
    });
  const setShip = (patch: Partial<Shipping>) => setShipping((s) => ({ ...(s ?? blankShipping(buyerName)), ...patch }));

  const missingPlate = isCar && Array.from({ length: qty }, (_, i) => rowAt(i).vehicle_plate.trim()).some((p) => !p);
  const shippingReady = !needsAddress || (!!shipping && !!shipping.name.trim() && !!shipping.mobile.trim() && !!shipping.address.trim() && !!shipping.city.trim() && !!shipping.province.trim() && /^\d{4}$/.test(shipping.zip.trim()));
  const blocked = !target || tooMany || reason.trim().length < 3 || missingPlate || !shippingReady;

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

  const shipField = (key: Exclude<keyof Shipping, "courier">, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input
      className="input py-1 text-sm"
      placeholder={label}
      aria-label={label}
      value={shipping?.[key] ?? ""}
      onChange={(e) => { setShip({ [key]: e.target.value }); setConfirm(false); }}
      {...extra}
    />
  );

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
              onChange={(e) => { setTypeId(e.target.value); setConfirm(false); setShowNames(false); }}
            >
              <option value="">Choose a ticket type&hellip;</option>
              {targets.map((t) => (
                <option key={t.id} value={t.id} disabled={t.sellable <= 0}>
                  {t.name} - {php(t.price_centavos)} ({t.sellable} left{t.included_companions ? `, +${t.included_companions} passenger` : ""})
                </option>
              ))}
            </select>
            {target && (
              <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                <BandSwatch color={target.band_color} size={10} label={false} /> {target.band_color} wristband
                {target.shares_stack_with && <> &middot; same bands as {target.shares_stack_with}</>}
                {fits > 0 && <> &middot; {php(currentTotalCentavos)} covers <b>{fits}</b> of these</>}
              </p>
            )}
            {target?.drifter_family && (
              <p className="mt-1 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-200">
                Paid for through this order, so it does <b>not</b> use up that drifter&apos;s {target.free_allowance} free bands. Hand-outs
                recorded on the Drifters tab are the only ones counted there.
              </p>
            )}
          </div>

          <div>
            <label className="label" htmlFor={`convert-qty-${orderId}`}>{isCar ? "How many cars" : "How many"}</label>
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
            {passengers > 0 && <p className="mt-1 text-xs text-zinc-500">Each car also gets {passengers} free passenger wristband{passengers > 1 ? "s" : ""}.</p>}
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

          {target && isCar && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-zinc-300">Car details</div>
              {Array.from({ length: qty }, (_, i) => (
                <div key={i} className="space-y-2 rounded-lg border border-white/10 bg-black/20 p-2">
                  <div className="text-[11px] text-zinc-500">Car {i + 1}</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input className="input py-1 text-sm uppercase" placeholder="Plate number *" aria-label={`Plate number of car ${i + 1}`} value={rowAt(i).vehicle_plate} onChange={(e) => { setRowAt(i, { vehicle_plate: e.target.value }); setConfirm(false); }} />
                    <input className="input py-1 text-sm" placeholder="Car model" aria-label={`Model of car ${i + 1}`} value={rowAt(i).vehicle_model} onChange={(e) => setRowAt(i, { vehicle_model: e.target.value })} />
                    <input className="input py-1 text-sm" placeholder={`Driver - ${buyerName}`} aria-label={`Driver of car ${i + 1}`} value={rowAt(i).holder_name} onChange={(e) => setRowAt(i, { holder_name: e.target.value })} />
                    {target.includes_shirt && (
                      <select className="input py-1 text-sm" aria-label={`Driver shirt size, car ${i + 1}`} value={rowAt(i).shirt_size} onChange={(e) => setRowAt(i, { shirt_size: e.target.value })}>
                        <option value="">Driver shirt size&hellip;</option>
                        {sizes.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    )}
                    {Array.from({ length: passengers }, (_, k) => (
                      <input
                        key={k}
                        className="input py-1 text-sm"
                        placeholder={`Free passenger${passengers > 1 ? ` ${k + 1}` : ""} - ${buyerName}`}
                        aria-label={`Passenger ${k + 1} of car ${i + 1}`}
                        value={rowAt(i).passengers[k] ?? ""}
                        onChange={(e) => { const ps = [...rowAt(i).passengers]; ps[k] = e.target.value; setRowAt(i, { passengers: ps }); }}
                      />
                    ))}
                  </div>
                </div>
              ))}
              <p className="text-xs text-zinc-500">The plate goes on the car pass. A blank name is issued to <b>{buyerName}</b>; the car photo is not needed here.</p>
            </div>
          )}

          {target && !isCar && (
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
                        value={rowAt(i).holder_name}
                        onChange={(e) => setRowAt(i, { holder_name: e.target.value })}
                        aria-label={`Holder name for ticket ${i + 1}`}
                      />
                      {target.includes_shirt && (
                        <select className="input w-24 py-1 text-sm" value={rowAt(i).shirt_size} onChange={(e) => setRowAt(i, { shirt_size: e.target.value })} aria-label={`Shirt size for ticket ${i + 1}`}>
                          <option value="">Size</option>
                          {sizes.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {target && needsAddress && (
            <div className="space-y-2 rounded-lg border border-violet-400/30 bg-violet-400/5 p-2">
              <div className="text-xs font-semibold text-violet-200">Where the shirt ships</div>
              {ctx?.shipping && !editShipping ? (
                <div className="text-xs text-zinc-300">
                  {ctx.shipping.name} · {ctx.shipping.mobile} · {ctx.shipping.address}, {ctx.shipping.city}, {ctx.shipping.province} {ctx.shipping.zip} ({ctx.shipping.courier})
                  <button type="button" className="ml-2 text-cyan-300 hover:underline" onClick={() => setEditShipping(true)}>Change</button>
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {shipField("name", "Recipient name *")}
                  {shipField("mobile", "Mobile for the courier *", { inputMode: "tel" })}
                  <div className="sm:col-span-2">{shipField("address", "House / unit no., street, barangay *")}</div>
                  {shipField("city", "City / municipality *")}
                  {shipField("province", "Province *")}
                  {shipField("zip", "ZIP code *", { inputMode: "numeric", maxLength: 4 })}
                  <select className="input py-1 text-sm" aria-label="Courier" value={shipping?.courier ?? "LBC"} onChange={(e) => setShip({ courier: e.target.value as Courier })}>
                    {COURIERS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              )}
              <p className="text-[11px] text-zinc-500">This ticket&apos;s shirt is made to order and delivered, not handed over at the gate. The buyer pays the shipping fee.</p>
            </div>
          )}

          <div>
            <label className="label" htmlFor={`convert-reason-${orderId}`}>Reason the buyer will see</label>
            <input
              id={`convert-reason-${orderId}`}
              className="input mt-1"
              placeholder="e.g. Upgraded to VIP Car Display at the buyer's request"
              value={reason}
              onChange={(e) => { setReason(e.target.value); setConfirm(false); }}
            />
          </div>

          {!confirm ? (
            <>
              <button type="button" className="btn-primary w-full" disabled={pending || blocked} onClick={() => setConfirm(true)}>
                {target ? <>Convert to {qty} &times; {target.name}&hellip;</> : <>Choose a ticket type first</>}
              </button>
              {target && missingPlate && <p className="text-xs text-amber-300">Enter a plate number for every car.</p>}
              {target && !missingPlate && !shippingReady && <p className="text-xs text-amber-300">Enter the full delivery address (4-digit ZIP).</p>}
            </>
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
                        attendees: Array.from({ length: qty }, (_, i) => rowAt(i)).map((n) => ({
                          holder_name: n.holder_name.trim() || undefined,
                          shirt_size: n.shirt_size.trim() || undefined,
                          vehicle_plate: isCar ? n.vehicle_plate.trim() || undefined : undefined,
                          vehicle_model: isCar ? n.vehicle_model.trim() || undefined : undefined,
                          passengers: isCar ? Array.from({ length: passengers }, (_, k) => (n.passengers[k] ?? "").trim()) : undefined,
                        })),
                        shipping: needsAddress && (editShipping || !ctx?.shipping) && shipping ? shipping : undefined,
                      });
                      setMsg(r.ok ? r.warning ?? r.summary ?? "Converted" : r.error);
                      if (r.ok) { setOpen(false); setRows([]); setReason(""); setCtx(null); router.refresh(); }
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
