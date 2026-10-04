"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { closeGateShift, openGateShift } from "@/app/actions/walkin";
import { php } from "@/lib/money";
import { BandSwatch } from "@/components/BandSwatch";
import type { GateShiftLabel, GateShiftResult, PaymentMethod } from "@/lib/supabase/types";

export interface ShiftLabel { id: string; code: string; name: string; band_color: string | null }
export interface OpenShift { id: string; opened_at: string; figures: GateShiftResult }
export interface ClosedShift { id: string; closed_at: string; result: GateShiftResult; note: string | null }
export interface AdminShift {
  id: string;
  staff: string;
  opened_at: string;
  closed_at: string | null;
  /** Live figures for an open shift; the stored result for a closed one. */
  figures: GateShiftResult;
  note: string | null;
}

const EWALLETS: { key: PaymentMethod; label: string }[] = [
  { key: "gcash", label: "GCash" },
  { key: "maya", label: "Maya" },
  { key: "gotyme", label: "GoTyme" },
];

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" });

/** Whole bands only; blank means "not handed this label". */
const parseCount = (raw: string) => (raw.trim() === "" ? null : Number(raw));
const isCount = (n: number | null) => n === null || (Number.isInteger(n) && n >= 0 && n <= 100000);

/** "Matches", "Short ₱50.00", "Over 2 bands": the one thing to read at a glance. */
function Diff({ value, unit }: { value: number | null | undefined; unit: "cash" | "bands" }) {
  if (value == null) return <span className="text-xs text-zinc-500">not counted</span>;
  const amount = unit === "cash" ? php(Math.abs(value)) : `${Math.abs(value)} band${Math.abs(value) === 1 ? "" : "s"}`;
  const tone = value === 0
    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
    : value < 0 ? "border-rose-500/40 bg-rose-500/10 text-rose-300" : "border-amber-500/40 bg-amber-500/10 text-amber-300";
  return (
    <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${tone}`}>
      {value === 0 ? "Matches" : value < 0 ? `Short ${amount}` : `Over ${amount}`}
    </span>
  );
}

function EwalletLine({ figures }: { figures: GateShiftResult }) {
  const parts = EWALLETS.map((m) => ({ ...m, v: figures.methods?.[m.key] })).filter((m) => m.v && m.v.amount_centavos !== 0);
  if (parts.length === 0) return <span className="text-zinc-500">none</span>;
  return <>{parts.map((m) => `${m.label} ${php(m.v!.amount_centavos)}`).join(" · ")}</>;
}

/** The result of a closed shift: cash and every label, counted against expected. */
export function ShiftResult({ result, note }: { result: GateShiftResult; note: string | null }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="text-sm">
          <div className="font-semibold">Cash</div>
          <div className="text-xs text-zinc-400">
            Should be {php(result.expected_cash_centavos)} (start {php(result.opening_cash_centavos)} + cash sales {php(result.cash_sales_centavos)})
            &middot; counted {php(result.counted_cash_centavos ?? 0)}
          </div>
        </div>
        <Diff value={result.cash_difference_centavos} unit="cash" />
      </div>
      {result.labels.length > 0 && (
        <ul className="divide-y divide-white/10 rounded-lg border border-white/10 text-sm">
          {result.labels.map((l) => (
            <li key={l.ticket_type_id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-2">
              <div className="min-w-0">
                <div className="truncate font-medium"><span className="mr-1 rounded bg-white/10 px-1 font-black">{l.code}</span>{l.name}</div>
                <div className="text-xs text-zinc-500">
                  {l.received == null
                    ? `sold ${l.sold_bands} band${l.sold_bands === 1 ? "" : "s"}, none counted out at the start`
                    : `received ${l.received} · sold ${l.sold_bands} · should be left ${l.expected_left} · counted ${l.counted_left ?? "–"}`}
                </div>
              </div>
              {l.received != null && <Diff value={l.difference} unit="bands" />}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-zinc-400">E-wallets (check against the phone): <EwalletLine figures={result} /></p>
      {note && <p className="rounded-lg border border-white/10 bg-black/20 p-2 text-xs text-zinc-300">Note: {note}</p>}
    </div>
  );
}

/** Count the drawer and the bands, then close; shows the result straight away. */
function CloseForm({ shiftId, figures, onClosed, onCancel, forName }: {
  shiftId: string; figures: GateShiftResult; onClosed: (r: GateShiftResult, note: string | null) => void; onCancel: () => void; forName?: string;
}) {
  const [cash, setCash] = useState("");
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const counted: GateShiftLabel[] = figures.labels.filter((l) => l.received != null);

  function submit() {
    const cashN = Number(cash);
    if (cash.trim() === "" || !Number.isFinite(cashN) || cashN < 0) { setError("Enter the cash you counted (0 if none)."); return; }
    const bands: Record<string, number> = {};
    for (const l of counted) {
      const n = parseCount(counts[l.ticket_type_id] ?? "");
      if (n === null || !isCount(n)) { setError(`Count the ${l.name} bands left (a whole number).`); return; }
      bands[l.ticket_type_id] = n;
    }
    setError(null);
    start(async () => {
      const r = await closeGateShift({ shiftId, countedCash: cashN, bands, note: note.trim() || undefined });
      if (!r.ok || !r.result) { setError(r.ok ? "Could not close the shift" : r.error); return; }
      onClosed(r.result, note.trim() || null);
    });
  }

  return (
    <div className="space-y-3 rounded-lg border border-white/15 bg-black/30 p-3">
      <div className="text-sm font-semibold">Close {forName ? `${forName}'s` : "your"} shift</div>
      {counted.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Bands still in hand</div>
          <ul className="mt-1 space-y-1.5">
            {counted.map((l) => (
              <li key={l.ticket_type_id} className="grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-2 text-sm">
                <label htmlFor={`count-${shiftId}-${l.ticket_type_id}`} className="min-w-0">
                  <span className="block truncate"><span className="mr-1 rounded bg-white/10 px-1 font-black">{l.code}</span>{l.name}</span>
                  <span className="block text-xs text-zinc-500">received {l.received} · sold {l.sold_bands}</span>
                </label>
                <input
                  id={`count-${shiftId}-${l.ticket_type_id}`}
                  className="input py-1.5 text-right tabular-nums"
                  inputMode="numeric"
                  placeholder="count"
                  value={counts[l.ticket_type_id] ?? ""}
                  onChange={(e) => { setCounts((c) => ({ ...c, [l.ticket_type_id]: e.target.value.replace(/[^0-9]/g, "") })); setError(null); }}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)_8rem] items-center gap-2 text-sm">
        <label htmlFor={`cash-${shiftId}`}>
          <span className="block font-medium">Cash counted</span>
          <span className="block text-xs text-zinc-500">the whole drawer, starting cash included</span>
        </label>
        <input
          id={`cash-${shiftId}`}
          className="input py-1.5 text-right tabular-nums"
          inputMode="decimal"
          placeholder="PHP"
          value={cash}
          onChange={(e) => { setCash(e.target.value.replace(/[^0-9.]/g, "")); setError(null); }}
        />
      </div>
      <p className="text-xs text-zinc-400">E-wallets this shift (check against the phone): <EwalletLine figures={figures} /></p>
      <textarea
        id={`note-${shiftId}`}
        className="input min-h-16 text-sm"
        placeholder="Note (optional): explain any difference"
        maxLength={500}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      {error && <p className="text-sm text-rose-300">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary" disabled={pending} onClick={submit}>{pending ? "Closing…" : "Close shift"}</button>
        <button type="button" className="btn-secondary" disabled={pending} onClick={onCancel}>Cancel</button>
      </div>
      <p className="text-xs text-zinc-500">The counts are compared once and kept with the shift. Count carefully before you tap Close.</p>
    </div>
  );
}

/**
 * The seller's gate shift, above the counters: open it with the starting cash and the
 * bands handed over, sell, then close it with what is counted. Admins also see every
 * shift today and can close one someone left open.
 */
export function GateShift({ labels, myShift, lastClosed, isAdmin, shifts }: {
  labels: ShiftLabel[];
  myShift: OpenShift | null;
  lastClosed: ClosedShift | null;
  isAdmin: boolean;
  shifts: AdminShift[];
}) {
  const router = useRouter();
  const [cash, setCash] = useState("");
  const [bands, setBands] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [justClosed, setJustClosed] = useState<{ result: GateShiftResult; note: string | null } | null>(null);
  const [pending, start] = useTransition();

  function open() {
    const cashN = Number(cash || "0");
    if (!Number.isFinite(cashN) || cashN < 0) { setError("Enter the starting cash (0 if none)."); return; }
    const counts: Record<string, number> = {};
    for (const l of labels) {
      const n = parseCount(bands[l.id] ?? "");
      if (!isCount(n)) { setError(`The ${l.name} count must be a whole number.`); return; }
      if (n !== null) counts[l.id] = n;
    }
    setError(null);
    start(async () => {
      const r = await openGateShift({ openingCash: cashN, bands: counts });
      if (!r.ok) { setError(r.error); return; }
      setCash(""); setBands({}); setJustClosed(null);
      router.refresh();
    });
  }

  const shown = justClosed ?? (lastClosed && !myShift ? { result: lastClosed.result, note: lastClosed.note } : null);

  return (
    <div className="space-y-4">
      {myShift ? (
        <div className="card space-y-3 border-cyan-400/30 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-cyan-300">Your shift is open</div>
              <div className="text-sm text-zinc-300">since {time(myShift.opened_at)}</div>
            </div>
            {closing !== myShift.id && (
              <button type="button" className="btn-secondary" onClick={() => setClosing(myShift.id)}>Close shift…</button>
            )}
          </div>
          <dl className="grid gap-2 text-sm sm:grid-cols-3">
            <div className="rounded-lg bg-black/30 p-2">
              <dt className="text-[10px] uppercase tracking-wide text-zinc-500">Cash that should be in the drawer</dt>
              <dd className="text-lg font-black tabular-nums">{php(myShift.figures.expected_cash_centavos)}</dd>
              <dd className="text-xs text-zinc-500">start {php(myShift.figures.opening_cash_centavos)} + cash sales {php(myShift.figures.cash_sales_centavos)}</dd>
            </div>
            <div className="rounded-lg bg-black/30 p-2">
              <dt className="text-[10px] uppercase tracking-wide text-zinc-500">E-wallets</dt>
              <dd className="text-sm"><EwalletLine figures={myShift.figures} /></dd>
            </div>
            <div className="rounded-lg bg-black/30 p-2">
              <dt className="text-[10px] uppercase tracking-wide text-zinc-500">Bands sold this shift</dt>
              <dd className="text-lg font-black tabular-nums">{myShift.figures.labels.reduce((n, l) => n + l.sold_bands, 0)}</dd>
            </div>
          </dl>
          {closing === myShift.id && (
            <CloseForm
              shiftId={myShift.id}
              figures={myShift.figures}
              onCancel={() => setClosing(null)}
              onClosed={(result, note) => { setClosing(null); setJustClosed({ result, note }); router.refresh(); }}
            />
          )}
        </div>
      ) : (
        <div className="card space-y-3 border-amber-500/40 p-4">
          <div>
            <h2 className="font-semibold">Start your shift</h2>
            <p className="text-xs text-zinc-400">
              Count the cash in your drawer and the bands you were handed, per label. Leave a label blank if you are not selling it.
              When you close, what you count is checked against what you sold.
            </p>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_8rem] items-center gap-2 text-sm">
            <label htmlFor="open-cash" className="font-medium">Starting cash (panukli)</label>
            <input id="open-cash" className="input py-1.5 text-right tabular-nums" inputMode="decimal" placeholder="PHP 0"
              value={cash} onChange={(e) => { setCash(e.target.value.replace(/[^0-9.]/g, "")); setError(null); }} />
          </div>
          <ul className="space-y-1.5">
            {labels.map((l) => (
              <li key={l.id} className="grid grid-cols-[minmax(0,1fr)_8rem] items-center gap-2 text-sm">
                <label htmlFor={`open-band-${l.id}`} className="min-w-0">
                  <span className="block truncate"><span className="mr-1 rounded bg-white/10 px-1 font-black">{l.code}</span>{l.name}</span>
                  <BandSwatch color={l.band_color} className="text-xs text-zinc-500" />
                </label>
                <input id={`open-band-${l.id}`} className="input py-1.5 text-right tabular-nums" inputMode="numeric" placeholder="bands"
                  value={bands[l.id] ?? ""} onChange={(e) => { setBands((b) => ({ ...b, [l.id]: e.target.value.replace(/[^0-9]/g, "") })); setError(null); }} />
              </li>
            ))}
          </ul>
          {error && <p className="text-sm text-rose-300">{error}</p>}
          <button type="button" className="btn-primary w-full" disabled={pending} onClick={open}>{pending ? "Opening…" : "Open shift"}</button>
        </div>
      )}

      {shown && (
        <div className="card space-y-2 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            {justClosed ? "Shift closed" : `Your last shift, closed ${time(lastClosed!.closed_at)}`}
          </div>
          <ShiftResult result={shown.result} note={shown.note} />
        </div>
      )}

      {isAdmin && shifts.length > 0 && (
        <div className="card space-y-2 p-4">
          <h2 className="font-semibold">Gate shifts today</h2>
          <ul className="divide-y divide-white/10 text-sm">
            {shifts.map((s) => {
              const bandDiffs = s.figures.labels.filter((l) => l.difference != null && l.difference !== 0);
              return (
                <li key={s.id} className="space-y-2 py-2">
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <div className="min-w-0">
                      <div className="font-medium">{s.staff}</div>
                      <div className="text-xs text-zinc-500">
                        {time(s.opened_at)} – {s.closed_at ? time(s.closed_at) : "still open"} &middot; sales {php(s.figures.total_centavos)}
                        &middot; cash should be {php(s.figures.expected_cash_centavos)}
                      </div>
                      {s.closed_at && (
                        <div className="mt-1 text-xs text-zinc-400">
                          {bandDiffs.length === 0 ? "Bands match" : bandDiffs.map((l) => `${l.code} ${l.difference! > 0 ? "+" : ""}${l.difference}`).join(" · ")}
                          {s.note ? ` · “${s.note}”` : ""}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {s.closed_at
                        ? <Diff value={s.figures.cash_difference_centavos} unit="cash" />
                        : closing !== s.id && <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => setClosing(s.id)}>Close for them…</button>}
                    </div>
                  </div>
                  {!s.closed_at && closing === s.id && (
                    <CloseForm
                      shiftId={s.id}
                      figures={s.figures}
                      forName={s.staff}
                      onCancel={() => setClosing(null)}
                      onClosed={() => { setClosing(null); router.refresh(); }}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
