"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { handOverDrifterEntry } from "@/app/actions/drifter-entries";
import { drifterReference } from "@/lib/drifter";
import { php } from "@/lib/money";
import type { DrifterEntryRow, PaymentMethod } from "@/lib/supabase/types";

const METHODS: { key: PaymentMethod; label: string }[] = [
  { key: "cash", label: "Cash" },
  { key: "gotyme", label: "GoTyme" },
  { key: "gcash", label: "GCash" },
  { key: "maya", label: "Maya" },
];

/** Status pill; never wraps inside itself ("CHECK COMPETITOR / PASS"). */
const PILL = "whitespace-nowrap rounded-full border px-2 py-0.5 font-semibold uppercase tracking-wide";

const when = (iso: string) => new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * Drifters who pre-registered and still have people waiting for a band. On event
 * day this is the desk's queue: find the name, tick who is actually here, take
 * any payment past the free allowance, hand over. People who have not arrived
 * stay on the list and collect later under the same drifter.
 */
export function DrifterQueue({
  entries,
  allowance,
  priceCentavos,
  alreadyOut,
}: {
  entries: DrifterEntryRow[];
  allowance: number;
  priceCentavos: number;
  /** Bands each drifter (lower-cased name) already has, which eat into the free ones. */
  alreadyOut: Record<string, number>;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // the hand-over being prepared: who is here, and the payment for any extra bands
  const [active, setActive] = useState<string | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [payRef, setPayRef] = useState("");
  const [received, setReceived] = useState(false);
  const [pending, start] = useTransition();

  const waiting = entries.filter((e) => e.active && e.submitted_at && !e.handed_over_at);
  const q = query.trim().toLowerCase();
  const shown = q
    ? waiting.filter((e) =>
        [e.drifter_name, e.team_name ?? "", e.car_no ?? "", drifterReference(e.token), ...e.people.map((p) => p.name)]
          .some((v) => v.toLowerCase().includes(q)),
      )
    : waiting;
  const peopleWaiting = waiting.reduce((s, e) => s + e.people.filter((p) => !p.given_at).length, 0);
  const methodLabel = METHODS.find((m) => m.key === method)?.label ?? method;

  /** Free and paid split for handing over n more bands to this drifter now. */
  const split = (e: DrifterEntryRow, n: number) => {
    const before = alreadyOut[e.drifter_name.trim().toLowerCase()] ?? 0;
    const free = Math.max(0, Math.min(n, allowance - before));
    return { n, free, paid: n - free };
  };

  function begin(e: DrifterEntryRow | null) {
    setActive(e?.id ?? null);
    // Everyone still waiting starts ticked: the usual case is the whole group at once.
    setPicked(e ? e.people.map((p, i) => (p.given_at ? -1 : i)).filter((i) => i >= 0) : []);
    setMethod("cash");
    setPayRef("");
    setReceived(false);
    setMsg(null);
  }

  function handOver(e: DrifterEntryRow) {
    const s = split(e, picked.length);
    start(async () => {
      const r = await handOverDrifterEntry(e.id, method, { confirmed: received, ref: payRef }, [...picked].sort((a, b) => a - b));
      if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
      const charge = r.chargeCentavos ?? 0;
      const left = (r.of ?? 0) - (r.collected ?? 0);
      setMsg({
        ok: true,
        text: `Handed over ${s.n} band${s.n === 1 ? "" : "s"} to ${e.drifter_name}'s group`
          + (charge > 0 ? ` · ${php(charge)} received ${method === "cash" ? "in cash" : `via ${methodLabel}${payRef.trim() ? ` (ref ${payRef.trim()})` : ""}`}` : " · free")
          + (left > 0 ? ` · ${left} still to collect` : " · everyone has collected"),
      });
      begin(null);
      router.refresh();
    });
  }

  const note = msg && (
    <p className={`mt-3 rounded-lg border p-2 text-xs ${msg.ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-rose-500/40 bg-rose-500/10 text-rose-300"}`}>
      {msg.text}
    </p>
  );

  if (waiting.length === 0) {
    return (
      <div className="card p-4">
        <h2 className="font-semibold">Pre-registered lists</h2>
        <p className="mt-1 text-sm text-zinc-500">
          No one is waiting. When a drifter sends in their list, they appear here ready to hand over.
        </p>
        {note}
      </div>
    );
  }

  return (
    <div className="card overflow-x-auto p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="font-semibold">Pre-registered lists</h2>
          <p className="text-xs text-zinc-500">
            {waiting.length} drifter{waiting.length === 1 ? "" : "s"} &middot; {peopleWaiting} {peopleWaiting === 1 ? "person" : "people"} still to collect &middot;
            rules already confirmed by each drifter
          </p>
        </div>
        <input
          id="queue-search"
          className="input w-full sm:w-72"
          placeholder="Name, companion, team, car # or code"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search pre-registered drifters"
        />
      </div>

      {note}

      <ul className="mt-3 divide-y divide-white/10">
        {shown.map((e) => {
          const remaining = e.people.filter((p) => !p.given_at).length;
          const isOpen = open === e.id;
          const isActive = active === e.id;
          const s = split(e, isActive ? picked.length : remaining);
          const needsPay = isActive && s.paid > 0;
          const payOk = !needsPay || (received && (method === "cash" || payRef.trim().length >= 4));
          return (
            <li key={e.id} className="py-3">
              {/* name | count | actions on a wide screen; on a phone the actions drop to their own line */}
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,1fr)_10rem_auto]">
                <div className="min-w-0">
                  <div className="break-words font-semibold sm:truncate" title={e.drifter_name}>{e.drifter_name}</div>
                  <div className="break-words text-xs text-zinc-500 sm:truncate">
                    {[e.team_name ?? "no team", e.car_no ? `Car #${e.car_no}` : null, drifterReference(e.token)].filter(Boolean).join(" · ")}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px]">
                    <span className={`${PILL} border-emerald-500/35 bg-emerald-500/10 text-emerald-300`}>Rules confirmed</span>
                    {e.self_registered && (
                      <span className={`${PILL} border-amber-500/40 bg-amber-500/10 text-amber-300`} title="Signed up through the shared link, not from an entry list">
                        Check competitor pass
                      </span>
                    )}
                    {e.rules_ack_at && <span className="whitespace-nowrap text-xs text-zinc-500">{when(e.rules_ack_at)}</span>}
                  </div>
                </div>
                <div className="text-right text-sm sm:text-left">
                  <div className="whitespace-nowrap font-bold tabular-nums">
                    {remaining} to collect
                    {e.bands_given > 0 && <span className="font-normal text-zinc-500"> of {e.band_count}</span>}
                  </div>
                  <div className="whitespace-nowrap text-xs text-zinc-500">
                    {e.bands_given > 0 ? `${e.bands_given} already collected` : s.paid === 0 ? "all free" : `${s.free} free · ${s.paid} × ${php(priceCentavos)}`}
                  </div>
                </div>
                <div className="col-span-2 flex items-center justify-end gap-3 sm:col-span-1">
                  {!isActive && (
                    <button type="button" className="w-20 text-right text-xs text-cyan-300 hover:underline" onClick={() => setOpen(isOpen ? null : e.id)} aria-expanded={isOpen}>
                      {isOpen ? "Hide names" : "Names"}
                    </button>
                  )}
                  {isActive ? (
                    <button type="button" className="btn-secondary w-28 px-3 py-1.5 text-sm" disabled={pending} onClick={() => begin(null)}>Cancel</button>
                  ) : (
                    <button type="button" className="btn-primary w-28 px-3 py-1.5 text-sm" disabled={pending} onClick={() => begin(e)}>Hand over</button>
                  )}
                </div>
              </div>

              {isOpen && !isActive && (
                <ol className="mt-2 grid gap-x-6 gap-y-1 rounded-lg border border-white/10 bg-black/20 p-3 text-sm sm:grid-cols-2">
                  {e.people.map((p, i) => (
                    <li key={i} className="flex items-baseline justify-between gap-3">
                      <span className={`min-w-0 truncate ${p.given_at ? "text-zinc-500 line-through" : ""}`}>
                        <span className="mr-2 text-xs text-zinc-500 tabular-nums">{i + 1}</span>{p.name}
                      </span>
                      <span className="shrink-0 text-xs text-zinc-500">{p.given_at ? "collected" : p.role}</span>
                    </li>
                  ))}
                </ol>
              )}

              {/* Tick who is here. Anyone not ticked stays on the list to collect later. */}
              {isActive && (
                <div className="mt-3 space-y-3 rounded-lg border border-cyan-400/30 bg-cyan-400/5 p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="text-sm font-semibold text-cyan-100">Who is here now?</div>
                    <div className="flex gap-3 text-xs">
                      <button type="button" className="text-cyan-300 hover:underline"
                        onClick={() => { setPicked(e.people.map((p, i) => (p.given_at ? -1 : i)).filter((i) => i >= 0)); setReceived(false); }}>All waiting</button>
                      <button type="button" className="text-zinc-400 hover:underline" onClick={() => { setPicked([]); setReceived(false); }}>None</button>
                    </div>
                  </div>
                  <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                    {e.people.map((p, i) => {
                      const done = !!p.given_at;
                      const on = done || picked.includes(i);
                      return (
                        <li key={i}>
                          <label className={`flex items-center gap-2 rounded px-1 py-0.5 ${done ? "opacity-50" : "cursor-pointer hover:bg-white/5"}`}>
                            <input
                              type="checkbox"
                              className="h-4 w-4 shrink-0 accent-cyan-400"
                              checked={on}
                              disabled={done}
                              onChange={(ev) => {
                                setPicked((cur) => (ev.target.checked ? [...cur, i] : cur.filter((x) => x !== i)));
                                setReceived(false);
                              }}
                            />
                            <span className="min-w-0 flex-1 truncate">{p.name}</span>
                            <span className="shrink-0 text-xs text-zinc-500">{done ? "collected" : p.role}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="text-xs text-zinc-400">
                    {picked.length === 0
                      ? "Tick at least one person."
                      : `${picked.length} band${picked.length === 1 ? "" : "s"} now${remaining - picked.length > 0 ? ` · ${remaining - picked.length} stay on the list to collect later` : ""}${s.paid === 0 ? " · free" : ` · ${s.free} free, ${s.paid} to pay`}`}
                    {e.self_registered && <span className="block text-amber-300">Signed up through the shared link: check the competitor pass first.</span>}
                  </p>

                  {needsPay && (
                    <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                      <div className="text-sm font-semibold text-amber-100">
                        Collect {php(s.paid * priceCentavos)} for {s.paid} band{s.paid === 1 ? "" : "s"} past the free {allowance}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Paid by</span>
                        <div className="inline-flex rounded-lg border border-white/15 bg-black/30 p-0.5">
                          {METHODS.map((m) => (
                            <button
                              key={m.key}
                              type="button"
                              onClick={() => { setMethod(m.key); setReceived(false); }}
                              className={`rounded-md px-3 py-1 text-sm font-semibold transition ${method === m.key ? "bg-gradient-to-r from-cyan-300 to-green-300 text-zinc-950" : "text-zinc-300 hover:bg-white/10"}`}
                            >
                              {m.label}
                            </button>
                          ))}
                        </div>
                        {method !== "cash" && (
                          <input
                            id={`pay-ref-${e.id}`}
                            className="input w-full sm:w-56"
                            placeholder={`${methodLabel} reference number`}
                            value={payRef}
                            onChange={(ev) => setPayRef(ev.target.value)}
                            aria-label={`${methodLabel} reference number`}
                          />
                        )}
                      </div>
                      <label className="flex cursor-pointer items-start gap-2 text-sm">
                        <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-400" checked={received} onChange={(ev) => setReceived(ev.target.checked)} />
                        <span className="text-amber-50">
                          I received {php(s.paid * priceCentavos)} {method === "cash" ? "in cash" : `via ${methodLabel} and checked it in the account`}.
                        </span>
                      </label>
                    </div>
                  )}

                  <button
                    type="button"
                    className="btn-primary px-4 py-2 text-sm"
                    disabled={pending || picked.length === 0 || !payOk}
                    onClick={() => handOver(e)}
                  >
                    {pending ? "…" : `Hand over ${picked.length} band${picked.length === 1 ? "" : "s"}`}
                  </button>
                </div>
              )}
            </li>
          );
        })}
        {shown.length === 0 && <li className="py-3 text-sm text-zinc-500">No waiting list matches &ldquo;{query}&rdquo;.</li>}
      </ul>
    </div>
  );
}
