"use client";

import { LOCALE } from "@/config/site";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordWalkin, setWalkinPrice, undoWalkinSale, type RecordWalkinInput } from "@/app/actions/walkin";
import { COURIERS, gateShipsShirt, type Shipping } from "@/lib/shipping";
import { php } from "@/lib/money";
import { useRules } from "@/components/RulesProvider";
import { staffMethods } from "@/lib/rules-types";
import type { AvailabilityRow, PaymentMethod, TicketTypeRow } from "@/lib/supabase/types";
import { BandSwatch } from "@/components/BandSwatch";

export interface TallyToday {
  /** Sales today per label: bands, or cars for a label with included passengers. */
  byType: Record<string, { sales: number; centavos: number }>;
  byMethod: Record<PaymentMethod, number>;
  total_centavos: number;
  entries: number;
}
export interface TallyEntry {
  id: string;
  created_at: string;
  qty: number;
  free_qty: number;
  unit_price_centavos: number;
  payment_method: PaymentMethod;
  payment_ref: string | null;
  shirt_size: string | null;
  holder_name: string | null;
  vehicle_plate: string | null;
  /** Where this sale's shirt ships (VIP Pass at the gate); null when the shirt was handed over. */
  shipping: Shipping | null;
  type_name: string;
  code: string;
  band_color: string | null;
  staff: string | null;
}
/** A named gate sale still in (not taken back): a car by its plate, or a person by name. */
export interface GateSale {
  plate: string | null;
  name: string;
  size: string | null;
  at: string;
  /** Sales still in under this plate (always 1) or this name and shirt size. */
  count: number;
}

/** Plates compare on letters and digits only, as the database does. */
const plateKey = (p: string) => p.toUpperCase().replace(/[^A-Z0-9]/g, "");


function gatePrice(t: TicketTypeRow) {
  return t.walkin_price_centavos ?? t.price_centavos;
}

/** What the gate desk calls the label. */
const gateName = (t: TicketTypeRow) => t.walkin_name ?? t.name;

/** Bands in one sale: the buyer plus any passengers the label includes. */
const bandsPerSale = (t: TicketTypeRow) => 1 + Math.max(0, t.included_companions ?? 0);

/**
 * Sales still possible at the gate: the bands left, divided into whole sales, and
 * never past the label's limit (40 cars for VIP Car Display), which online and gate share.
 */
function salesLeft(t: TicketTypeRow, a: AvailabilityRow | undefined) {
  if (!a) return 0;
  const byBands = Math.floor(Number(a.pool_sellable ?? 0) / bandsPerSale(t));
  return a.online_cap == null ? byBands : Math.min(byBands, Number(a.online_cap) - Number(a.cap_used ?? 0));
}

function PriceEditor({ t, onSaved }: { t: TicketTypeRow; onSaved: () => void }) {
  const [value, setValue] = useState(gatePrice(t) ? String(gatePrice(t) / 100) : "");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        start(async () => {
          const r = await setWalkinPrice(t.id, Number(value));
          if (!r.ok) setErr(r.error);
          else onSaved();
        });
      }}
    >
      <span className="text-sm text-zinc-400">PHP</span>
      <input className="input w-24 py-1 text-sm" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0" aria-label={`Gate price for ${t.name} ${t.band_color ?? ""}`} />
      <button className="btn-secondary px-2 py-1 text-xs" disabled={pending}>{pending ? "..." : "Save"}</button>
      {err && <span className="text-xs text-rose-400">{err}</span>}
    </form>
  );
}

/** A sale sent with no answer back: it may or may not be in, and a retry is safe. */
interface Unconfirmed { t: TicketTypeRow; delta: number; input: RecordWalkinInput; label: string }
/** The last sale, undoable for a few seconds. */
interface LastSale { saleId: string; label: string; until: number }

const UNDO_SECONDS = 10;

export function WalkinTally({
  types,
  availability,
  today,
  recent,
  shirts,
  gateSales,
  isAdmin,
}: {
  types: TicketTypeRow[];
  availability: AvailabilityRow[];
  today: TallyToday;
  recent: TallyEntry[];
  /** Shirts handed over at the gate so far: typeId -> size -> count. */
  shirts: Record<string, Record<string, number>>;
  /** Named gate sales per label (cars, VIP Pass holders), newest first. */
  gateSales: Record<string, GateSale[]>;
  isAdmin: boolean;
}) {
  const rules = useRules();
  const METHODS = staffMethods(rules.channels);
  const SHIRT_SIZES = rules.shirtChart.map((r) => r.size);
  const router = useRouter();
  // Back to Cash after every sale, so one GCash buyer does not turn the next ten into GCash.
  const [method, setMethod] = useState<PaymentMethod>("cash");
  // The e-wallet reference for the next sale; cleared after every sale.
  const [payRef, setPayRef] = useState("");
  // Delivery address per label whose shirt ships, typed before the sale.
  const [shipFor, setShipFor] = useState<Record<string, Shipping>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState<Unconfirmed | null>(null);
  const [last, setLast] = useState<LastSale | null>(null);
  const [now, setNow] = useState(0);
  // One request at a time: two taps in the same instant would otherwise be two sales.
  const inFlight = useRef(false);
  const methodLabel = METHODS.find((m) => m.key === method)?.label ?? method;

  // Tick the undo countdown while there is something to undo.
  useEffect(() => {
    if (!last) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [last]);
  const undoLeft = last ? Math.max(0, Math.ceil((last.until - now) / 1000)) : 0;
  const [editing, setEditing] = useState<string | null>(null);
  // Optimistic adjustments until the server refresh lands: typeId -> sales
  const [pendingDelta, setPendingDelta] = useState<Record<string, number>>({});
  // The shirt size picked for the next tap on a label with a shirt. Cleared after
  // every tap, so each sale is a deliberate choice rather than the last one's size.
  const [sizeFor, setSizeFor] = useState<Record<string, string | null>>({});
  // Labels that take a name (and a plate, for cars): the details for the next sale, or
  // the plate / name of the sale to take back.
  const [whoFor, setWhoFor] = useState<Record<string, { name: string; plate: string }>>({});
  const [, start] = useTransition();

  const avail = (id: string) => availability.find((a) => a.ticket_type_id === id);
  const whoOf = (id: string) => whoFor[id] ?? { name: "", plate: "" };
  const blankShip = (): Shipping => ({ name: "", mobile: "", address: "", city: "", province: "", zip: "", courier: "LBC" });
  const shipOf = (id: string) => shipFor[id] ?? blankShip();
  const setShip = (id: string, patch: Partial<Shipping>) => { setShipFor((cur) => ({ ...cur, [id]: { ...(cur[id] ?? blankShip()), ...patch } })); setError(null); };
  /** The address with the recipient defaulting to the name typed for the sale. */
  const shipFilled = (t: TicketTypeRow): Shipping => { const s = shipOf(t.id); return { ...s, name: s.name.trim() || whoOf(t.id).name.trim() }; };
  const shipReady = (t: TicketTypeRow) => {
    const s = shipFilled(t);
    return s.name.length >= 2 && /^(\+?63|0)?9\d{9}$/.test(s.mobile.replace(/[\s-]/g, "")) && s.address.trim().length >= 5 && s.city.trim().length >= 2 && s.province.trim().length >= 2 && /^\d{4}$/.test(s.zip.trim());
  };
  const setWho = (id: string, patch: Partial<{ name: string; plate: string }>) => {
    setWhoFor((cur) => ({ ...cur, [id]: { ...(cur[id] ?? { name: "", plate: "" }), ...patch } }));
    setError(null);
  };

  function tap(t: TicketTypeRow, delta: number) {
    const car = t.requires_vehicle;
    const isNamed = car || t.gate_needs_name;
    const who = whoOf(t.id);
    const back = delta < 0;
    // A named sale goes back by its plate (cars) or its name, with the size it was sold with.
    const size = t.includes_shirt && !(isNamed && back) ? sizeFor[t.id] ?? null : null;
    const sendName = isNamed && !(car && back);
    if (car && plateKey(who.plate).length < 3) { setError(`Enter the plate number for ${gateName(t)}.`); return; }
    if (sendName && who.name.trim().length < 2) {
      setError(back ? `Type or pick the name to take back for ${gateName(t)}.` : `Enter the ${car ? "driver's " : ""}name for ${gateName(t)}.`);
      return;
    }
    if (t.includes_shirt && !(isNamed && back) && !size) { setError(`Pick the shirt size for ${gateName(t)} first.`); return; }
    const ships = gateShipsShirt(t) && !back;
    if (ships && !shipReady(t)) { setError(`Enter where the ${gateName(t)} shirt ships: mobile, address, city, province and 4-digit ZIP.`); return; }
    const ewallet = !back && method !== "cash";
    if (ewallet && payRef.trim().length < 4) { setError(`Enter the ${methodLabel} reference number for this sale.`); return; }

    const n = Math.abs(delta);
    const what = bandsPerSale(t) > 1 ? `${n} car${n === 1 ? "" : "s"} (${n * bandsPerSale(t)} bands)` : `${n} band${n === 1 ? "" : "s"}`;
    const whoText = car
      ? ` · ${who.plate.trim().toUpperCase()}${back ? "" : `, ${who.name.trim()}`}`
      : isNamed ? ` · ${who.name.trim()}` : "";
    const label = `${back ? "−" : "+"}${what} · ${gateName(t)}${whoText}${size ? ` · ${size} shirt${ships ? " (ships)" : ""}` : ""} · ${back ? "−" : ""}${php(gatePrice(t) * n)} ${methodLabel.toUpperCase()}${ewallet ? ` ref ${payRef.trim()}` : ""}`;
    send({
      t, delta, label,
      input: {
        ticketTypeId: t.id, delta, method, shirtSize: size,
        holderName: sendName ? who.name.trim() : null, vehiclePlate: car ? who.plate.trim() : null,
        paymentRef: ewallet ? payRef.trim() : null,
        shipping: ships ? shipFilled(t) : null,
        // a fresh id per sale; a retry of this same sale sends it again
        clientRef: crypto.randomUUID(),
      },
    });
  }

  function send(job: Unconfirmed) {
    if (inFlight.current) return;
    inFlight.current = true;
    const { t, delta, input } = job;
    setError(null);
    setUnconfirmed(null);
    setBusy(t.id);
    setPendingDelta((d) => ({ ...d, [t.id]: (d[t.id] ?? 0) + delta }));
    start(async () => {
      let r: Awaited<ReturnType<typeof recordWalkin>> | null = null;
      try {
        r = await recordWalkin(input);
      } catch {
        // No answer back. The sale may or may not be in; the same clientRef makes a retry safe.
        setUnconfirmed(job);
      }
      if (r && !r.ok) setError(r.error);
      if (!r || !r.ok) setPendingDelta((d) => ({ ...d, [t.id]: (d[t.id] ?? 0) - delta }));
      if (r?.ok) {
        setFlash(`${job.label}${r.duplicate ? " (it had already gone through)" : ""}`);
        if (delta > 0 && r.saleId) { setLast({ saleId: r.saleId, label: job.label, until: Date.now() + UNDO_SECONDS * 1000 }); setNow(Date.now()); }
        else setLast(null);
        setSizeFor((s) => ({ ...s, [t.id]: null }));
        if (t.requires_vehicle || t.gate_needs_name) setWhoFor((c) => ({ ...c, [t.id]: { name: "", plate: "" } }));
        if (delta > 0) setShipFor((c) => ({ ...c, [t.id]: blankShip() }));
        setMethod("cash");
        setPayRef("");
      }
      inFlight.current = false;
      setBusy(null);
      router.refresh();
      // Once the fresh numbers arrive the optimistic delta is redundant.
      setTimeout(() => setPendingDelta((d) => ({ ...d, [t.id]: 0 })), 600);
    });
  }

  /** Reverse the last sale exactly: same bands, shirt, name, plate, payment. */
  function undo() {
    if (!last || inFlight.current) return;
    const sale = last;
    inFlight.current = true;
    setLast(null);
    start(async () => {
      try {
        const r = await undoWalkinSale(sale.saleId);
        if (!r.ok) setError(r.error);
        else setFlash(`Undone: ${sale.label}`);
      } catch {
        setError("No answer from the server. Check Recent entries before undoing again.");
      }
      inFlight.current = false;
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      {/* payment for the next sale only */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Paid by</span>
          <div className="inline-flex rounded-lg border border-white/15 bg-black/30 p-0.5">
            {METHODS.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => { setMethod(m.key); setError(null); }}
                className={`rounded-md px-4 py-1.5 text-sm font-semibold transition ${method === m.key ? "bg-gradient-to-r from-cyan-300 to-green-300 text-zinc-950" : "text-zinc-300 hover:bg-white/10"}`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <span className="text-xs text-zinc-500">Goes back to Cash after every sale.</span>
        </div>
        {method !== "cash" && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              id="walkin-pay-ref"
              className="input w-full sm:w-72"
              autoComplete="off"
              placeholder={`${methodLabel} reference number`}
              value={payRef}
              onChange={(e) => { setPayRef(e.target.value); setError(null); }}
            />
            <span className="text-xs text-zinc-500">Check that the transfer arrived before handing over the band.</span>
          </div>
        )}
      </div>

      {unconfirmed && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">
          <b>No answer from the server.</b> This sale may or may not be in: {unconfirmed.label}.
          Do not hand over another band yet.
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="btn-primary px-3 py-1.5 text-sm" disabled={!!busy} onClick={() => send(unconfirmed)}>
              Retry (it will not be recorded twice)
            </button>
            <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={() => setUnconfirmed(null)}>Dismiss</button>
          </div>
        </div>
      )}
      {error && <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</p>}
      {flash && !error && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs text-emerald-300">
          <span>Recorded: {flash}</span>
          {last && undoLeft > 0 && (
            <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={undo}>Undo ({undoLeft}s)</button>
          )}
        </div>
      )}

      {/* one counter per label */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {types.map((t) => {
          const a = avail(t.id);
          const price = gatePrice(t);
          const noPrice = price <= 0;
          const perSale = bandsPerSale(t);
          const unit = perSale > 1 ? "cars" : "bands";
          const delta = pendingDelta[t.id] ?? 0;
          // walk-in sales so far: bands minus the free passenger bands inside packages
          const total = Number(a?.walkin_sold ?? 0) - Number(a?.free_bands ?? 0) + delta;
          const todayQty = (today.byType[t.id]?.sales ?? 0) + delta;
          const left = salesLeft(t, a) - delta;
          const isBusy = busy === t.id;
          const size = sizeFor[t.id] ?? null;
          const needSize = t.includes_shirt && !size;
          const car = t.requires_vehicle;
          const isNamed = car || t.gate_needs_name;
          const who = whoOf(t.id);
          const plateOk = !car || plateKey(who.plate).length >= 3;
          const nameOk = !isNamed || who.name.trim().length >= 2;
          const ships = gateShipsShirt(t);
          const shipOk = !ships || shipReady(t);
          const canAdd = !needSize && plateOk && nameOk && shipOk;
          // a named sale goes back by its plate (cars) or name; other shirt labels need the size
          const canTakeBack = car ? plateOk : isNamed ? nameOk : !needSize;
          const sold = gateSales[t.id] ?? [];
          const soldCount = sold.reduce((n, x) => n + x.count, 0);
          const given = Object.entries(shirts[t.id] ?? {}).filter(([, n]) => n > 0)
            .sort(([x], [y]) => SHIRT_SIZES.indexOf(x) - SHIRT_SIZES.indexOf(y));
          return (
            <div key={t.id} className="card relative flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-white/10 text-base font-black">{t.code}</span>
                    <div className="min-w-0">
                      <div className="font-semibold leading-tight">{gateName(t)}</div>
                      <BandSwatch color={t.band_color} className="text-xs text-zinc-400" />
                    </div>
                  </div>
                  {(perSale > 1 || t.includes_shirt || t.requires_vehicle) && (
                    <p className="mt-1.5 text-xs text-zinc-400">
                      {perSale > 1
                        ? <>1 tap = 1 car: driver + {perSale - 1} passenger, {perSale} {t.band_color?.toLowerCase() ?? ""} bands{t.includes_shirt ? ", 1 shirt (driver)" : ""}.</>
                        : t.requires_vehicle
                          ? <>1 tap = 1 car, driver only{t.includes_shirt ? ", 1 shirt" : ", no shirt"}.</>
                          : <>Includes 1 shirt.</>}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  {editing === t.id ? (
                    <PriceEditor t={t} onSaved={() => { setEditing(null); router.refresh(); }} />
                  ) : (
                    <>
                      <div className={`text-lg font-bold ${noPrice ? "text-amber-300" : ""}`}>{noPrice ? "No price" : php(price)}</div>
                      {isAdmin && <button type="button" className="text-xs text-cyan-300 hover:underline" onClick={() => setEditing(t.id)}>{noPrice ? "Set gate price" : "Change"}</button>}
                    </>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 rounded-lg bg-black/30 p-2 text-center">
                <div><div className="text-2xl font-black tabular-nums">{todayQty}</div><div className="text-[10px] uppercase tracking-wide text-zinc-500">{unit} today</div></div>
                <div><div className="text-2xl font-black tabular-nums">{total}</div><div className="text-[10px] uppercase tracking-wide text-zinc-500">total walk-in</div></div>
                <div><div className={`text-2xl font-black tabular-nums ${left <= 20 ? "text-rose-400" : ""}`}>{left}</div><div className="text-[10px] uppercase tracking-wide text-zinc-500">{unit} left</div></div>
              </div>

              {/* who the sale is for (and which car), before the sale */}
              {isNamed && (
                <div className={car ? "grid grid-cols-[minmax(0,1fr)_7.5rem] gap-2" : ""}>
                  <div>
                    <label className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500" htmlFor={`gate-name-${t.id}`}>
                      {car ? <>Driver&apos;s name</> : "Name"}
                    </label>
                    <input
                      id={`gate-name-${t.id}`}
                      className="input mt-1 py-1.5"
                      autoComplete="off"
                      placeholder="e.g. Juan Dela Cruz"
                      value={who.name}
                      onChange={(e) => setWho(t.id, { name: e.target.value })}
                    />
                  </div>
                  {car && (
                  <div>
                    <label className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500" htmlFor={`car-plate-${t.id}`}>Plate no.</label>
                    <input
                      id={`car-plate-${t.id}`}
                      className="input mt-1 py-1.5 uppercase"
                      autoComplete="off"
                      autoCapitalize="characters"
                      placeholder="ABC 1234"
                      maxLength={20}
                      value={who.plate}
                      onChange={(e) => setWho(t.id, { plate: e.target.value })}
                    />
                  </div>
                  )}
                </div>
              )}

              {/* the shirt handed over with this sale; required before + or − */}
              {t.includes_shirt && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{ships ? "Shirt size to ship" : "Shirt size handed over"}</div>
                  <div className="mt-1 flex flex-wrap gap-1" role="radiogroup" aria-label={`Shirt size for ${gateName(t)}`}>
                    {SHIRT_SIZES.map((s) => (
                      <button
                        key={s}
                        type="button"
                        role="radio"
                        aria-checked={size === s}
                        onClick={() => { setSizeFor((cur) => ({ ...cur, [t.id]: cur[t.id] === s ? null : s })); setError(null); }}
                        className={`min-w-10 rounded-md border px-2 py-1 text-xs font-semibold transition ${size === s ? "border-transparent bg-gradient-to-r from-cyan-300 to-green-300 text-zinc-950" : "border-white/15 text-zinc-300 hover:bg-white/10"}`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* VIP Pass: the shirt is made to order and delivered, so take the address before the sale */}
              {ships && (
                <div className="space-y-1.5 rounded-lg border border-violet-400/30 bg-violet-400/5 p-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-violet-200">Ship the shirt to</div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <input className="input py-1.5 text-sm" placeholder={`Recipient: ${who.name.trim() || "same as name"}`} aria-label="Shirt recipient" autoComplete="off" value={shipOf(t.id).name} onChange={(e) => setShip(t.id, { name: e.target.value })} />
                    <input className="input py-1.5 text-sm" placeholder="Mobile 09…" aria-label="Recipient mobile" inputMode="tel" autoComplete="off" value={shipOf(t.id).mobile} onChange={(e) => setShip(t.id, { mobile: e.target.value })} />
                    <input className="input col-span-2 py-1.5 text-sm" placeholder="House / unit no., street, barangay" aria-label="Street address" autoComplete="off" value={shipOf(t.id).address} onChange={(e) => setShip(t.id, { address: e.target.value })} />
                    <input className="input py-1.5 text-sm" placeholder="City / municipality" aria-label="City" autoComplete="off" value={shipOf(t.id).city} onChange={(e) => setShip(t.id, { city: e.target.value })} />
                    <input className="input py-1.5 text-sm" placeholder="Province" aria-label="Province" autoComplete="off" value={shipOf(t.id).province} onChange={(e) => setShip(t.id, { province: e.target.value })} />
                    <input className="input py-1.5 text-sm" placeholder="ZIP" aria-label="ZIP code" inputMode="numeric" maxLength={4} autoComplete="off" value={shipOf(t.id).zip} onChange={(e) => setShip(t.id, { zip: e.target.value })} />
                    <select className="input py-1.5 text-sm" aria-label="Courier" value={shipOf(t.id).courier} onChange={(e) => setShip(t.id, { courier: e.target.value as Shipping["courier"] })}>
                      {COURIERS.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <p className="text-[10px] text-zinc-500">Made to order, about two weeks, then sent by courier; the buyer pays the shipping fee. Do not hand a shirt over.</p>
                </div>
              )}

              <div className="flex items-stretch gap-2">
                <button
                  type="button"
                  className="btn-secondary h-14 w-16 shrink-0 text-2xl font-black"
                  disabled={isBusy || total <= 0 || !canTakeBack}
                  title={!canTakeBack
                    ? car ? "Type or tap the plate of the car to take back"
                      : isNamed ? "Type or tap the name to take back"
                      : "Pick the shirt size to take back first"
                    : undefined}
                  onClick={() => tap(t, -1)}
                  aria-label={car ? `Take back the car ${who.plate}` : isNamed ? `Take back the sale for ${who.name}` : `Take back one ${gateName(t)}${size ? `, ${size} shirt` : ""}`}
                >
                  −
                </button>
                <button
                  type="button"
                  className="btn-go h-14 flex-1 text-2xl font-black"
                  disabled={isBusy || noPrice || left <= 0 || !canAdd}
                  onClick={() => tap(t, 1)}
                  aria-label={`Add one ${gateName(t)}${size ? `, ${size} shirt` : ""}`}
                >
                  {isBusy ? "…"
                    : !nameOk || !plateOk ? <span className="text-sm font-bold">{car ? <>Name &amp; plate first</> : "Name first"}</span>
                    : needSize ? <span className="text-sm font-bold">Pick a size</span>
                    : !shipOk ? <span className="text-sm font-bold">Address first</span>
                    : perSale > 1 || car ? "+1 car" : "+1"}
                </button>
                {/* five at once only where every sale is the same: no package, no shirt size, no name */}
                {perSale === 1 && !t.includes_shirt && !isNamed && (
                  <button type="button" className="btn-secondary h-14 w-16 shrink-0 text-base font-bold" disabled={isBusy || noPrice || left < 5} onClick={() => tap(t, 5)} aria-label={`Add five ${gateName(t)}`}>+5</button>
                )}
              </div>
              {given.length > 0 && (
                <p className="text-xs text-zinc-500">
                  {ships ? "Shirts to ship from gate sales" : "Shirts given at the gate"}: {given.map(([s, n]) => `${s} ${n}`).join(" · ")}
                </p>
              )}
              {/* named sales in through the gate; tapping one fills its plate or name so − takes it back */}
              {isNamed && sold.length > 0 && (
                <details className="rounded-lg border border-white/10 bg-black/20 text-xs">
                  <summary className="cursor-pointer px-2 py-1.5 font-semibold text-zinc-300">
                    {car ? `${soldCount} car${soldCount === 1 ? "" : "s"}` : soldCount} sold at the gate
                  </summary>
                  <ul className="max-h-48 divide-y divide-white/10 overflow-y-auto">
                    {sold.map((x) => (
                      <li key={`${x.plate ?? ""}|${x.name}|${x.size ?? ""}`}>
                        <button
                          type="button"
                          className={`grid w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-white/5 ${car ? "grid-cols-[5.5rem_minmax(0,1fr)_auto]" : "grid-cols-[minmax(0,1fr)_auto]"}`}
                          onClick={() => setWho(t.id, car ? { plate: x.plate ?? "", name: "" } : { name: x.name })}
                          title={car ? "Fill this plate, then tap − to take the car back" : "Fill this name, then tap − to take the sale back"}
                        >
                          {car && <span className="font-mono font-semibold text-zinc-100">{x.plate}</span>}
                          <span className={`truncate ${car ? "text-zinc-400" : "text-zinc-100"}`}>{x.name}</span>
                          <span className="text-zinc-500">{x.size ?? ""}{x.count > 1 ? ` ×${x.count}` : ""}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {noPrice && <p className="text-xs text-amber-300">Adding is blocked until an admin sets the gate price.</p>}
            </div>
          );
        })}
      </div>

      {/* today's cash-up + recent entries */}
      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <div className="card">
          <h2 className="font-semibold">Today&apos;s walk-in total</h2>
          <div className="mt-2 text-3xl font-black">{php(today.total_centavos)}</div>
          <div className="text-xs text-zinc-500">{today.entries} entr{today.entries === 1 ? "y" : "ies"} recorded today</div>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
            {METHODS.map((m) => (
              <div key={m.key} className="rounded-lg bg-black/30 p-2">
                <dt className="text-[10px] uppercase tracking-wide text-zinc-500">{m.label}</dt>
                <dd className="font-bold">{php(today.byMethod[m.key] ?? 0)}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="card">
          <h2 className="font-semibold">Recent entries</h2>
          {recent.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-500">Nothing recorded yet. Tap + when you hand over a wristband.</p>
          ) : (
            // Scrolls inside the card so a busy gate day does not push the page down.
            <div className="mt-2 max-h-[min(28rem,60vh)] overflow-auto overscroll-contain">
            <table className="w-full text-sm">
              <tbody>
                {recent.map((e) => {
                  const sales = e.qty - e.free_qty;
                  return (
                  <tr key={e.id} className="border-t">
                    <td className="whitespace-nowrap py-1.5 text-xs text-zinc-500">{new Date(e.created_at).toLocaleTimeString(LOCALE.locale, { timeZone: LOCALE.timeZone, hour: "numeric", minute: "2-digit" })}</td>
                    <td className={`whitespace-nowrap font-bold tabular-nums ${e.qty < 0 ? "text-rose-400" : "text-emerald-300"}`}>
                      {sales > 0 ? `+${sales}` : sales}
                      {e.free_qty !== 0 && <span className="ml-1 text-[10px] font-normal text-zinc-500">car ({Math.abs(e.qty)} bands)</span>}
                    </td>
                    <td>
                      <span className="mr-1 rounded bg-white/10 px-1 font-black">{e.code}</span>{e.type_name}
                      {e.shirt_size && <span className="ml-1 rounded border border-white/15 px-1 text-[10px] font-semibold text-zinc-300">{e.shirt_size}</span>}
                      {(e.vehicle_plate || e.holder_name) && (
                        <span className="block text-xs text-zinc-500">
                          {e.vehicle_plate && <span className="font-mono">{e.vehicle_plate}</span>}
                          {e.vehicle_plate && e.holder_name ? " · " : ""}
                          {e.holder_name}
                        </span>
                      )}
                      {e.shipping && <span className="block text-[11px] text-violet-300">Shirt ships to {e.shipping.city} via {e.shipping.courier}</span>}
                    </td>
                    <td className="text-zinc-500"><BandSwatch color={e.band_color} label={false} size={10} /> {e.band_color}</td>
                    <td className="text-right">{php(sales * e.unit_price_centavos)}</td>
                    <td className="text-right text-xs uppercase text-zinc-500">
                      {e.payment_method}
                      {e.payment_ref && <span className="block font-mono normal-case text-[10px]">{e.payment_ref}</span>}
                    </td>
                    <td className="text-right text-xs text-zinc-500">{e.staff ?? ""}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
