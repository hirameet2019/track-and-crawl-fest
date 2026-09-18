"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordWalkin, setWalkinPrice } from "@/app/actions/walkin";
import { php } from "@/lib/money";
import type { AvailabilityRow, PaymentMethod, TicketTypeRow } from "@/lib/supabase/types";
import { BandSwatch } from "@/components/BandSwatch";

export interface TallyToday {
  byType: Record<string, { qty: number; centavos: number }>;
  byMethod: Record<PaymentMethod, number>;
  total_centavos: number;
  entries: number;
}
export interface TallyEntry {
  id: string;
  created_at: string;
  qty: number;
  unit_price_centavos: number;
  payment_method: PaymentMethod;
  type_name: string;
  code: string;
  band_color: string | null;
  staff: string | null;
}

const METHODS: { key: PaymentMethod; label: string }[] = [
  { key: "cash", label: "Cash" },
  { key: "gotyme", label: "GoTyme" },
  { key: "gcash", label: "GCash" },
  { key: "maya", label: "Maya" },
];

function gatePrice(t: TicketTypeRow) {
  return t.walkin_price_centavos ?? t.price_centavos;
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
  isAdmin,
}: {
  types: TicketTypeRow[];
  availability: AvailabilityRow[];
  today: TallyToday;
  recent: TallyEntry[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  // Optimistic adjustments until the server refresh lands: typeId -> delta
  const [pendingDelta, setPendingDelta] = useState<Record<string, number>>({});
  const [, start] = useTransition();

  const avail = (id: string) => availability.find((a) => a.ticket_type_id === id);

  function tap(t: TicketTypeRow, delta: number) {
    setError(null);
    setBusy(t.id);
    setPendingDelta((d) => ({ ...d, [t.id]: (d[t.id] ?? 0) + delta }));
    start(async () => {
      const r = await recordWalkin({ ticketTypeId: t.id, delta, method });
      if (!r.ok) {
        setError(r.error);
        setPendingDelta((d) => ({ ...d, [t.id]: (d[t.id] ?? 0) - delta }));
      } else {
        setFlash(`${delta > 0 ? "+" : ""}${delta} ${t.name} (${t.band_color}) · ${php(gatePrice(t) * Math.abs(delta))} ${method.toUpperCase()}`);
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
          const delta = pendingDelta[t.id] ?? 0;
          const total = Number(a?.walkin_sold ?? 0) + delta;
          const todayQty = (today.byType[t.id]?.qty ?? 0) + delta;
          const left = Number(a?.sellable ?? 0) - delta;
          const isBusy = busy === t.id;
          return (
            <div key={t.id} className="card relative flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="grid h-8 w-8 place-items-center rounded-md bg-white/10 text-base font-black">{t.code}</span>
                    <div>
                      <div className="font-semibold leading-tight">{t.name}</div>
                      <BandSwatch color={t.band_color} className="text-xs text-zinc-400" />
                    </div>
                  </div>
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
                <div><div className="text-2xl font-black tabular-nums">{todayQty}</div><div className="text-[10px] uppercase tracking-wide text-zinc-500">today</div></div>
                <div><div className="text-2xl font-black tabular-nums">{total}</div><div className="text-[10px] uppercase tracking-wide text-zinc-500">total walk-in</div></div>
                <div><div className={`text-2xl font-black tabular-nums ${left <= 20 ? "text-rose-400" : ""}`}>{left}</div><div className="text-[10px] uppercase tracking-wide text-zinc-500">bands left</div></div>
              </div>

              <div className="flex items-stretch gap-2">
                <button type="button" className="btn-secondary h-14 w-16 shrink-0 text-2xl font-black" disabled={isBusy || total <= 0} onClick={() => tap(t, -1)} aria-label={`Subtract one ${t.name} ${t.band_color ?? ""}`}>−</button>
                <button
                  type="button"
                  className="btn-primary h-14 flex-1 text-2xl font-black"
                  disabled={isBusy || noPrice || left <= 0}
                  onClick={() => tap(t, 1)}
                  aria-label={`Add one ${t.name} ${t.band_color ?? ""}`}
                >
                  {isBusy ? "…" : "+1"}
                </button>
                <button type="button" className="btn-secondary h-14 w-16 shrink-0 text-base font-bold" disabled={isBusy || noPrice || left < 5} onClick={() => tap(t, 5)} aria-label={`Add five ${t.name} ${t.band_color ?? ""}`}>+5</button>
              </div>
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
                {recent.map((e) => (
                  <tr key={e.id} className="border-t">
                    <td className="py-1.5 text-xs text-zinc-500">{new Date(e.created_at).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit" })}</td>
                    <td className={`font-bold tabular-nums ${e.qty < 0 ? "text-rose-400" : "text-emerald-300"}`}>{e.qty > 0 ? `+${e.qty}` : e.qty}</td>
                    <td><span className="mr-1 rounded bg-white/10 px-1 font-black">{e.code}</span>{e.type_name}</td>
                    <td className="text-zinc-500"><BandSwatch color={e.band_color} label={false} size={10} /> {e.band_color}</td>
                    <td className="text-right">{php(e.qty * e.unit_price_centavos)}</td>
                    <td className="text-right text-xs uppercase text-zinc-500">{e.payment_method}</td>
                    <td className="text-right text-xs text-zinc-500">{e.staff ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
