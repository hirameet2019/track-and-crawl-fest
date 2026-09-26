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

const when = (iso: string) => new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * Drifters who pre-registered through their link and are waiting for their bands.
 * On event day this is the desk's queue: find the name, see the face, hand over.
 * The paperwork - who is with them, the rules confirmation - is already done.
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
  /** Bands each drifter (lower-cased name) already took at the desk, which eat into the free ones. */
  alreadyOut: Record<string, number>;
}) {
  const router = useRouter();
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [query, setQuery] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const waiting = entries.filter((e) => e.active && e.submitted_at && !e.handed_over_at);
  const q = query.trim().toLowerCase();
  const shown = q
    ? waiting.filter((e) =>
        [e.drifter_name, e.team_name ?? "", e.car_no ?? "", drifterReference(e.token)].some((v) => v.toLowerCase().includes(q)),
      )
    : waiting;

  /** Free and paid split for this list, counting bands the drifter already took. */
  const split = (e: DrifterEntryRow) => {
    const before = alreadyOut[e.drifter_name.trim().toLowerCase()] ?? 0;
    const n = e.band_count ?? 0;
    const free = Math.max(0, Math.min(n, allowance - before));
    return { n, free, paid: n - free };
  };
  const anyPaid = waiting.some((e) => split(e).paid > 0);
  const bandsWaiting = waiting.reduce((s, e) => s + (e.band_count ?? 0), 0);

  function handOver(e: DrifterEntryRow) {
    setMsg(null);
    start(async () => {
      const r = await handOverDrifterEntry(e.id, method);
      setConfirming(null);
      if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
      const charge = r.chargeCentavos ?? 0;
      setMsg({
        ok: true,
        text: `Handed over ${e.band_count} band${e.band_count === 1 ? "" : "s"} to ${e.drifter_name}${charge > 0 ? ` · collect ${php(charge)} ${method.toUpperCase()}` : " · all free"}`,
      });
      router.refresh();
    });
  }

  if (waiting.length === 0) {
    return (
      <div className="card p-4">
        <h2 className="font-semibold">Pre-registered lists</h2>
        <p className="mt-1 text-sm text-zinc-500">
          No drifter has sent in a list yet. Once they do through their private link, they appear here ready to hand over.
        </p>
        {msg && <p className={`mt-3 rounded-lg border p-2 text-xs ${msg.ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-rose-500/40 bg-rose-500/10 text-rose-300"}`}>{msg.text}</p>}
      </div>
    );
  }

  return (
    <div className="card overflow-x-auto p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-semibold">Pre-registered lists</h2>
          <p className="text-xs text-zinc-500">
            {waiting.length} drifter{waiting.length === 1 ? "" : "s"} waiting &middot; {bandsWaiting} band{bandsWaiting === 1 ? "" : "s"} &middot;
            rules already confirmed by each drifter
          </p>
        </div>
        <input
          id="queue-search"
          className="input w-full sm:w-64"
          placeholder="Find a name, team, car # or MD3- code"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search pre-registered drifters"
        />
      </div>

      {anyPaid && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Extra bands paid by</span>
          <div className="inline-flex rounded-lg border border-white/15 bg-black/30 p-0.5">
            {METHODS.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setMethod(m.key)}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${method === m.key ? "bg-gradient-to-r from-cyan-300 to-green-300 text-zinc-950" : "text-zinc-300 hover:bg-white/10"}`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {msg && <p className={`mt-3 rounded-lg border p-2 text-xs ${msg.ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-rose-500/40 bg-rose-500/10 text-rose-300"}`}>{msg.text}</p>}

      <ul className="mt-3 divide-y divide-white/10">
        {shown.map((e) => {
          const s = split(e);
          const isOpen = open === e.id;
          return (
            <li key={e.id} className="py-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{e.drifter_name}</div>
                  <div className="text-xs text-zinc-500">
                    {[e.team_name ?? "no team", e.car_no ? `Car #${e.car_no}` : null, drifterReference(e.token)].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <div className="w-32 text-sm">
                  <div className="font-bold tabular-nums">{s.n} band{s.n === 1 ? "" : "s"}</div>
                  <div className="text-xs text-zinc-500">
                    {s.paid === 0 ? "all free" : `${s.free} free · ${s.paid} × ${php(priceCentavos)}`}
                  </div>
                </div>
                <div className="w-36 text-xs">
                  <span className="inline-block rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 font-semibold uppercase tracking-wide text-emerald-300">Rules confirmed</span>
                  {e.rules_ack_at && <div className="mt-0.5 text-zinc-500">{when(e.rules_ack_at)}</div>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button type="button" className="text-xs text-cyan-300 hover:underline" onClick={() => setOpen(isOpen ? null : e.id)} aria-expanded={isOpen}>
                    {isOpen ? "Hide names" : "Names"}
                  </button>
                  {confirming === e.id ? (
                    <>
                      <button type="button" className="btn-primary px-3 py-1.5 text-sm" disabled={pending} onClick={() => handOver(e)}>
                        {pending ? "…" : `Yes, ${s.n} band${s.n === 1 ? "" : "s"}${s.paid > 0 ? ` + ${php(s.paid * priceCentavos)}` : ""}`}
                      </button>
                      <button type="button" className="btn-secondary px-3 py-1.5 text-sm" disabled={pending} onClick={() => setConfirming(null)}>Cancel</button>
                    </>
                  ) : (
                    <button type="button" className="btn-primary px-3 py-1.5 text-sm" disabled={pending} onClick={() => { setConfirming(e.id); setMsg(null); }}>
                      Hand over
                    </button>
                  )}
                </div>
              </div>
              {isOpen && (
                <ol className="mt-2 grid gap-x-6 gap-y-1 rounded-lg border border-white/10 bg-black/20 p-3 text-sm sm:grid-cols-2">
                  {e.people.map((p, i) => (
                    <li key={i} className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate"><span className="mr-2 text-xs text-zinc-500 tabular-nums">{i + 1}</span>{p.name}</span>
                      <span className="shrink-0 text-xs text-zinc-500">{p.role}</span>
                    </li>
                  ))}
                </ol>
              )}
            </li>
          );
        })}
        {shown.length === 0 && <li className="py-3 text-sm text-zinc-500">No waiting list matches &ldquo;{query}&rdquo;.</li>}
      </ul>
    </div>
  );
}
