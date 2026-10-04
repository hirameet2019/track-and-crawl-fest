"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordWalkin, setWalkinPrice } from "@/app/actions/walkin";
import { php } from "@/lib/money";
import { SHIRT_SIZES, type ShirtSize } from "@/config/event";
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
  shirt_size: string | null;
  holder_name: string | null;
  vehicle_plate: string | null;
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

const METHODS: { key: PaymentMethod; label: string }[] = [
  { key: "cash", label: "Cash" },
  { key: "gotyme", label: "GoTyme" },
  { key: "gcash", label: "GCash" },
  { key: "maya", label: "Maya" },
];

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
  const router = useRouter();
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  // Optimistic adjustments until the server refresh lands: typeId -> sales
  const [pendingDelta, setPendingDelta] = useState<Record<string, number>>({});
  // The shirt size picked for the next tap on a label with a shirt. Cleared after
  // every tap, so each sale is a deliberate choice rather than the last one's size.
  const [sizeFor, setSizeFor] = useState<Record<string, ShirtSize | null>>({});
  // Labels that take a name (and a plate, for cars): the details for the next sale, or
  // the plate / name of the sale to take back.
  const [whoFor, setWhoFor] = useState<Record<string, { name: string; plate: string }>>({});
  const [, start] = useTransition();

  const avail = (id: string) => availability.find((a) => a.ticket_type_id === id);
  const whoOf = (id: string) => whoFor[id] ?? { name: "", plate: "" };
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
    setError(null);
    setBusy(t.id);
    setPendingDelta((d) => ({ ...d, [t.id]: (d[t.id] ?? 0) + delta }));
    start(async () => {
      const r = await recordWalkin({
        ticketTypeId: t.id, delta, method, shirtSize: size,
        holderName: sendName ? who.name.trim() : null, vehiclePlate: car ? who.plate.trim() : null,
      });
      if (!r.ok) {
        setError(r.error);
        setPendingDelta((d) => ({ ...d, [t.id]: (d[t.id] ?? 0) - delta }));
      } else {
        const n = Math.abs(delta);
        const what = bandsPerSale(t) > 1 ? `${n} car${n === 1 ? "" : "s"} (${n * bandsPerSale(t)} bands)` : `${n} band${n === 1 ? "" : "s"}`;
        const whoText = car
          ? ` · ${who.plate.trim().toUpperCase()}${back ? "" : `, ${who.name.trim()}`}`
          : isNamed ? ` · ${who.name.trim()}` : "";
        setFlash(`${back ? "−" : "+"}${what} · ${gateName(t)}${whoText}${size ? ` · ${size} shirt` : ""} · ${php(gatePrice(t) * n)} ${method.toUpperCase()}`);
        setSizeFor((s) => ({ ...s, [t.id]: null }));
        if (isNamed) setWhoFor((c) => ({ ...c, [t.id]: { name: "", plate: "" } }));
      }
      setBusy(null);
      router.refresh();
      // Once the fresh numbers arrive the optimistic delta is redundant.
      setTimeout(() => setPendingDelta((d) => ({ ...d, [t.id]: 0 })), 600);
    });
  }

  return (
    <div className="space-y-5">
      {/* payment method for the next taps */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Paid by</span>
        <div className="inline-flex rounded-lg border border-white/15 bg-black/30 p-0.5">
          {METHODS.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setMethod(m.key)}
              className={`rounded-md px-4 py-1.5 text-sm font-semibold transition ${method === m.key ? "bg-gradient-to-r from-cyan-300 to-green-300 text-zinc-950" : "text-zinc-300 hover:bg-white/10"}`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-zinc-500">Applies to the next + / − you tap.</span>
      </div>

      {error && <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</p>}
      {flash && !error && <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs text-emerald-300">Recorded: {flash}</p>}

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
          const canAdd = !needSize && plateOk && nameOk;
          // a named sale goes back by its plate (cars) or name; other shirt labels need the size
          const canTakeBack = car ? plateOk : isNamed ? nameOk : !needSize;
          const sold = gateSales[t.id] ?? [];
          const soldCount = sold.reduce((n, x) => n + x.count, 0);
          const given = Object.entries(shirts[t.id] ?? {}).filter(([, n]) => n > 0)
            .sort(([x], [y]) => SHIRT_SIZES.indexOf(x as ShirtSize) - SHIRT_SIZES.indexOf(y as ShirtSize));
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
                  {(perSale > 1 || t.includes_shirt) && (
                    <p className="mt-1.5 text-xs text-zinc-400">
                      {perSale > 1
                        ? <>1 tap = 1 car: driver + {perSale - 1} passenger, {perSale} {t.band_color?.toLowerCase() ?? ""} bands{t.includes_shirt ? ", 1 shirt (driver)" : ""}.</>
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
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Shirt size handed over</div>
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
                  className="btn-primary h-14 flex-1 text-2xl font-black"
                  disabled={isBusy || noPrice || left <= 0 || !canAdd}
                  onClick={() => tap(t, 1)}
                  aria-label={`Add one ${gateName(t)}${size ? `, ${size} shirt` : ""}`}
                >
                  {isBusy ? "…"
                    : !nameOk || !plateOk ? <span className="text-sm font-bold">{car ? <>Name &amp; plate first</> : "Name first"}</span>
                    : needSize ? <span className="text-sm font-bold">Pick a size</span>
                    : perSale > 1 ? "+1 car" : "+1"}
                </button>
                {/* five at once only where every sale is the same: no package, no shirt size */}
                {perSale === 1 && !t.includes_shirt && (
                  <button type="button" className="btn-secondary h-14 w-16 shrink-0 text-base font-bold" disabled={isBusy || noPrice || left < 5} onClick={() => tap(t, 5)} aria-label={`Add five ${gateName(t)}`}>+5</button>
                )}
              </div>
              {given.length > 0 && (
                <p className="text-xs text-zinc-500">
                  Shirts given at the gate: {given.map(([s, n]) => `${s} ${n}`).join(" · ")}
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
          <a href="/api/admin/export?type=walkin" className="btn-secondary mt-4 w-full">Export walk-in tally (CSV)</a>
        </div>
        <div className="card overflow-x-auto">
          <h2 className="font-semibold">Recent entries</h2>
          {recent.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-500">Nothing recorded yet. Tap + when you hand over a wristband.</p>
          ) : (
            <table className="mt-2 w-full text-sm">
              <tbody>
                {recent.map((e) => {
                  const sales = e.qty - e.free_qty;
                  return (
                  <tr key={e.id} className="border-t">
                    <td className="whitespace-nowrap py-1.5 text-xs text-zinc-500">{new Date(e.created_at).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" })}</td>
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
                    </td>
                    <td className="text-zinc-500"><BandSwatch color={e.band_color} label={false} size={10} /> {e.band_color}</td>
                    <td className="text-right">{php(sales * e.unit_price_centavos)}</td>
                    <td className="text-right text-xs uppercase text-zinc-500">{e.payment_method}</td>
                    <td className="text-right text-xs text-zinc-500">{e.staff ?? ""}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
