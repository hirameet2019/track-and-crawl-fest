"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { convertOrder, getConvertTargets, type ConvertContext, type ConvertTicket } from "@/app/actions/admin";
import { php } from "@/lib/money";
import { BandSwatch } from "@/components/BandSwatch";
import { useRules } from "@/components/RulesProvider";
import { COURIERS, type Courier, type Shipping } from "@/lib/shipping";

type Row = { holder_name: string; shirt_size: string; vehicle_plate: string; vehicle_model: string; passengers: string[] };
const blankRow = (): Row => ({ holder_name: "", shirt_size: "", vehicle_plate: "", vehicle_model: "", passengers: [] });
const blankShipping = (buyerName: string): Shipping => ({ name: buyerName, mobile: "", address: "", city: "", province: "", zip: "", courier: "LBC" });
const plateKey = (p: string | null) => (p ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
/** A car ticket's free passengers (they move with the car). */
const passengersOf = (all: ConvertTicket[], car: ConvertTicket) =>
  car.vehicle_plate ? all.filter((p) => p.passenger_of && plateKey(p.passenger_of) === plateKey(car.vehicle_plate)) : [];
/** New ticket details start from the picked tickets: same holders, sizes, plates and passengers. */
const rowsFor = (all: ConvertTicket[], picked: Set<string>): Row[] =>
  all
    .filter((t) => !t.passenger_of && picked.has(t.id))
    .map((t) => ({
      holder_name: t.holder_name ?? "",
      shirt_size: t.shirt_size ?? "",
      vehicle_plate: t.vehicle_plate ?? "",
      vehicle_model: t.vehicle_model ?? "",
      passengers: passengersOf(all, t).map((x) => x.holder_name ?? ""),
    }));

/**
 * Swap a paid order's tickets to a different ticket type without losing the order
 * number, the receipt or the payment trail. Used when a buyer changes their mind
 * after paying - the alternative is voiding and making them order again. Staff pick
 * which tickets change (all of them by default); the others keep their wristband
 * number and QR code, and the balance only counts the picked ones.
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
  const { shirtChart, terms: T } = useRules();
  const sizes = shirtChart.map((r) => r.size);
  const [open, setOpen] = useState(false);
  const [ctx, setCtx] = useState<ConvertContext | null>(null);
  const [typeId, setTypeId] = useState("");
  const [qty, setQty] = useState(1);
  const [reason, setReason] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [showNames, setShowNames] = useState(false);
  const [shipping, setShipping] = useState<Shipping | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
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
      // Every live ticket is picked to start with: the whole order, as before.
      const all = new Set(c.tickets.filter((t) => !t.redeemed && !t.passenger_of).map((t) => t.id));
      setPicked(all);
      setQty(Math.max(1, Math.min(50, all.size)));
      setRows(rowsFor(c.tickets, all));
    });
    return () => { live = false; };
  }, [open, ctx, orderId]);

  const targets = ctx?.targets ?? null;
  const target = targets?.find((t) => t.id === typeId) ?? null;
  const isCar = !!target?.requires_vehicle;
  const passengers = target?.included_companions ?? 0;
  const needsAddress = !!target?.ships_shirt;
  const tickets = ctx?.tickets ?? [];
  /** Tickets that can be picked: everything but the free passengers, which follow their car. */
  const mains = tickets.filter((t) => !t.passenger_of);
  const pickedMains = mains.filter((t) => picked.has(t.id));
  const pickedAll = pickedMains.flatMap((t) => [t, ...passengersOf(tickets, t).filter((x) => !x.redeemed)]);
  const liveCount = tickets.filter((t) => !t.redeemed).length;
  const keptCount = liveCount - pickedAll.length;
  /** What the picked tickets were bought for: the money this change works from. */
  const pickedValue = ctx ? pickedAll.reduce((n, t) => n + t.price_centavos, 0) : currentTotalCentavos;
  const newTotal = target ? target.price_centavos * qty : 0;
  const balance = pickedValue - newTotal;
  /** How many of the chosen ticket the picked tickets' money would cover exactly. */
  const fits = target && target.price_centavos > 0 ? Math.floor(pickedValue / target.price_centavos) : 0;

  function toggle(id: string) {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id); else next.add(id);
    setPicked(next);
    setQty(Math.max(1, Math.min(50, next.size)));
    setRows(rowsFor(tickets, next));
    setConfirm(false);
  }
  function pickAll(on: boolean) {
    const next = new Set(on ? mains.filter((t) => !t.redeemed).map((t) => t.id) : []);
    setPicked(next);
    setQty(Math.max(1, Math.min(50, next.size)));
    setRows(rowsFor(tickets, next));
    setConfirm(false);
  }
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
  const blocked = !target || pickedMains.length === 0 || tooMany || reason.trim().length < 3 || missingPlate || !shippingReady;

  if (!open) {
    return (
      <div className="space-y-2">
        <button type="button" className="btn-secondary w-full" onClick={() => setOpen(true)}>
          Change to another ticket&hellip;
        </button>
        {hasRedeemed && <p className="text-[11px] text-zinc-500">Tickets already scanned at the gate stay as they are; the others can still be changed.</p>}
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
            Pick the tickets that change; the others keep their {T.one} number and QR code. Keeps the order number
            and receipt. The picked tickets&apos; bands go back to the pool, new ones are issued, and the buyer gets one
            email with the updated PDF. Any difference in price is left as a balance to settle by hand.
          </p>
        </div>
        <button type="button" className="text-xs text-zinc-400 hover:text-white/90" onClick={() => setOpen(false)}>Close</button>
      </div>

      {targets === null ? (
        <p className="text-xs text-zinc-500">Loading ticket types&hellip;</p>
      ) : liveCount === 0 ? (
        <p className="text-xs text-zinc-400">Every ticket in this order was already scanned at the gate, so there is nothing left to change.</p>
      ) : (
        <>
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="label">Tickets to change</span>
              <span className="text-[11px] text-zinc-500">
                {pickedAll.length} of {liveCount}
                {pickedMains.length < mains.filter((t) => !t.redeemed).length
                  ? <button type="button" className="ml-2 text-cyan-300 hover:underline" onClick={() => pickAll(true)}>All</button>
                  : <button type="button" className="ml-2 text-cyan-300 hover:underline" onClick={() => pickAll(false)}>None</button>}
              </span>
            </div>
            <ul className="mt-1 space-y-1">
              {mains.map((t) => {
                const on = picked.has(t.id);
                const riders = passengersOf(tickets, t);
                return (
                  <li key={t.id}>
                    <label className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-sm ${t.redeemed ? "border-white/5 opacity-50" : on ? "cursor-pointer border-cyan-300/50 bg-cyan-300/10" : "cursor-pointer border-white/10"}`}>
                      <input type="checkbox" className="h-4 w-4 accent-cyan-400" checked={on} disabled={t.redeemed} onChange={() => toggle(t.id)} aria-label={`Change ticket ${t.number}`} />
                      <span className="shrink-0 rounded bg-white/10 px-1 text-[11px] font-black">{t.code}</span>
                      <span className="shrink-0 font-mono text-xs">{t.number}</span>
                      <span className="min-w-0 flex-1 truncate">{t.holder_name}{t.vehicle_plate && !t.passenger_of ? <span className="text-zinc-500"> &middot; {t.vehicle_plate}</span> : null}</span>
                      <span className="shrink-0 text-xs text-zinc-400">{t.redeemed ? "scanned" : php(t.price_centavos)}</span>
                    </label>
                    {riders.map((x) => (
                      <div key={x.id} className="ml-8 mt-0.5 text-[11px] text-zinc-500">
                        + {x.number} free passenger{x.holder_name ? <> &middot; {x.holder_name}</> : null}{x.redeemed ? " (scanned, stays)" : " (moves with the car)"}
                      </div>
                    ))}
                  </li>
                );
              })}
            </ul>
            {pickedMains.length === 0 && <p className="mt-1 text-xs text-amber-300">Pick at least one ticket to change.</p>}
          </div>

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
                <BandSwatch color={target.band_color} size={10} label={false} /> {target.band_color} {T.one}
                {target.shares_stack_with && <> &middot; same bands as {target.shares_stack_with}</>}
                {fits > 0 && <> &middot; {php(pickedValue)} covers <b>{fits}</b> of these</>}
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
                  use all {php(pickedValue)} ({fits})
                </button>
              )}
            </div>
            {tooMany && <p className="mt-1 text-xs text-rose-400">Only {target?.sellable} left for that label.</p>}
            {passengers > 0 && <p className="mt-1 text-xs text-zinc-500">Each car also gets {passengers} free passenger {passengers > 1 ? T.many : T.one}.</p>}
          </div>

          {target && (
            <dl className="grid grid-cols-3 gap-2 rounded-lg bg-black/30 p-2 text-center text-xs">
              <div><dt className="text-zinc-500">{keptCount > 0 ? "Paid for these" : "Paid"}</dt><dd className="text-sm font-bold">{php(pickedValue)}</dd></div>
              <div><dt className="text-zinc-500">New total</dt><dd className="text-sm font-bold">{php(newTotal)}</dd></div>
              <div>
                <dt className="text-zinc-500">{balance >= 0 ? "To refund" : "To collect"}</dt>
                <dd className={`text-sm font-bold ${balance > 0 ? "text-amber-300" : balance < 0 ? "text-rose-400" : ""}`}>{php(Math.abs(balance))}</dd>
              </div>
            </dl>
          )}

          {target && isCar && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-white/75">Car details</div>
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
                <div className="text-xs text-white/75">
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
              placeholder="e.g. Changed from Car to Motorcycle at the buyer's request"
              value={reason}
              onChange={(e) => { setReason(e.target.value); setConfirm(false); }}
            />
          </div>

          {!confirm ? (
            <>
              <button type="button" className="btn-primary w-full" disabled={pending || blocked} onClick={() => setConfirm(true)}>
                {!target
                  ? <>Choose a ticket type first</>
                  : keptCount > 0
                    ? <>Change {pickedAll.length} ticket{pickedAll.length === 1 ? "" : "s"} to {qty} &times; {target.name}&hellip;</>
                    : <>Convert to {qty} &times; {target.name}&hellip;</>}
              </button>
              {target && missingPlate && <p className="text-xs text-amber-300">Enter a plate number for every car.</p>}
              {target && !missingPlate && !shippingReady && <p className="text-xs text-amber-300">Enter the full delivery address (4-digit ZIP).</p>}
            </>
          ) : (
            <div className="space-y-2">
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-200">
                {keptCount > 0
                  ? <>The {T.one} number{pickedAll.length === 1 ? "" : "s"} of the {pickedAll.length} picked ticket{pickedAll.length === 1 ? "" : "s"} stop working immediately; the other {keptCount} stay as they are. The buyer is emailed.</>
                  : <>The {T.one} numbers on this order stop working immediately and the buyer is emailed.</>}
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
                        ticketIds: pickedMains.map((t) => t.id),
                        attendees: Array.from({ length: qty }, (_, i) => rowAt(i)).map((n) => ({
                          holder_name: n.holder_name.trim() || undefined,
                          shirt_size: target?.includes_shirt ? n.shirt_size.trim() || undefined : undefined,
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
