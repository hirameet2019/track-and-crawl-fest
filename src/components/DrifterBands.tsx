"use client";

import { LOCALE } from "@/config/site";
import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { recordDrifterBands, setDrifterAllowance } from "@/app/actions/drifters";
import { setWalkinPrice } from "@/app/actions/walkin";
import { php } from "@/lib/money";
import { BandSwatch } from "@/components/BandSwatch";
import { DRIFTER_CONFIRMATION, drifterRules } from "@/lib/drifter-rules";
import { DrifterQueue } from "@/components/DrifterQueue";
import { DrifterLinks } from "@/components/DrifterLinks";
import { RuleLines, RulesHeading } from "@/components/RuleLines";
import type { AvailabilityRow, DrifterBandRow, DrifterEntryRow, PaymentMethod, TicketTypeRow } from "@/lib/supabase/types";
import { useRules } from "@/components/RulesProvider";
import { staffMethods } from "@/lib/rules-types";

export interface DrifterEntry {
  id: string;
  created_at: string;
  drifter_name: string;
  team_name: string | null;
  payment_ref: string | null;
  payment_confirmed: boolean;
  qty: number;
  free_qty: number;
  unit_price_centavos: number;
  payment_method: PaymentMethod;
  staff: string | null;
}

/** Drifter Family bands that reached a family through a converted order, one row per order. */
export interface OrderBandRow {
  order_id: string;
  order_no: number;
  buyer_name: string;
  holder_name: string | null;
  numbers: string[];
  amount_centavos: number;
}


const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Cells need side padding or a right-aligned number butts straight into the next
 * column ("12D-0001"). The first and last columns stay flush so the table still
 * lines up with the card's own padding.
 */
const TABLE =
  "mt-2 w-full text-sm [&_th]:px-2 [&_td]:px-2 sm:[&_th]:px-3 sm:[&_td]:px-3 [&_th:first-child]:pl-0 [&_td:first-child]:pl-0 [&_th:last-child]:pr-0 [&_td:last-child]:pr-0";

/**
 * "Handed out here" columns, shared by the header and every row so they line up.
 * The button column is a fixed width (a 2rem "−", a gap and a 4rem "+ Add"): an
 * auto column would size itself separately in the header and in each row.
 */
const HANDED_COLS =
  "grid grid-cols-[minmax(0,1fr)_6.375rem] items-center gap-x-3 sm:grid-cols-[minmax(0,1fr)_3rem_3rem_3rem_5.5rem_6.375rem]";

/** Small inline number editor used for both the gate price and the free allowance. */
function InlineNumber({
  value,
  unit,
  label,
  onSave,
}: {
  value: string;
  unit: string;
  label: string;
  onSave: (raw: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  if (!editing) {
    return (
      <button type="button" className="text-xs text-cyan-300 hover:underline" onClick={() => { setDraft(value); setEditing(true); }}>
        Change
      </button>
    );
  }
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        start(async () => {
          const r = await onSave(draft);
          if (!r.ok) setErr(r.error ?? "Could not save");
          else { setEditing(false); router.refresh(); }
        });
      }}
    >
      <span className="text-xs text-zinc-400">{unit}</span>
      <input className="input w-20 py-1 text-sm" inputMode="decimal" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={label} autoFocus />
      <button className="btn-secondary px-2 py-1 text-xs" disabled={pending}>{pending ? "..." : "Save"}</button>
      <button type="button" className="px-1 text-xs text-zinc-500 hover:text-white/75" onClick={() => setEditing(false)}>Cancel</button>
      {err && <span className="text-xs text-rose-400">{err}</span>}
    </form>
  );
}

/**
 * Drifter wristbands: a tally kept per competing driver, separate from the public
 * gate tally. The first few bands per drifter are free and the rest are charged,
 * so every hand-out is booked against a name rather than a bare count, and none
 * leaves the desk until the drifter has confirmed the rules.
 */
export function DrifterBands({
  type,
  avail,
  drifters,
  recent,
  orderBands,
  entries,
  siteUrl,
  isAdmin,
}: {
  type: TicketTypeRow;
  avail: AvailabilityRow | undefined;
  drifters: DrifterBandRow[];
  recent: DrifterEntry[];
  orderBands: OrderBandRow[];
  /** The organizer's entry list with each drifter's link and submitted list. */
  entries: DrifterEntryRow[];
  siteUrl: string;
  isAdmin: boolean;
}) {
  const METHODS = staffMethods(useRules().channels);
  const router = useRouter();
  const [name, setName] = useState("");
  const [team, setTeam] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  // Cleared after every hand-out and whenever the name changes, so the drifter in
  // front of the staff member is the one who agreed - not the previous team.
  const [rulesAck, setRulesAck] = useState(false);
  // Payment for bands past the free allowance; cleared after every hand-out.
  const [payRef, setPayRef] = useState("");
  const [payReceived, setPayReceived] = useState(false);
  // The manual form is the exception once lists are pre-registered, so it starts folded.
  const [deskOpen, setDeskOpen] = useState(false);
  const [, start] = useTransition();

  const price = type.walkin_price_centavos ?? type.price_centavos;
  const allowance = type.free_allowance;
  const poolTotal = Number(avail?.pool_total ?? 0);
  const left = Number(avail?.sellable ?? 0);

  // Every band out of this pool, whichever door it came through: the tally below,
  // and orders converted into this label. Without the second the tiles read zero
  // while "bands left" has already dropped, which is what staff noticed.
  const totals = useMemo(() => {
    const gate = drifters.reduce((s, d) => s + d.bands, 0);
    const viaOrders = orderBands.reduce((s, o) => s + o.numbers.length, 0);
    return {
      families: drifters.length,
      gate,
      viaOrders,
      bands: gate + viaOrders,
      free: drifters.reduce((s, d) => s + d.free_bands, 0),
      paid: drifters.reduce((s, d) => s + d.paid_bands, 0),
      amount: drifters.reduce((s, d) => s + Number(d.amount_centavos), 0) + orderBands.reduce((s, o) => s + o.amount_centavos, 0),
    };
  }, [drifters, orderBands]);

  /** The typed name matched against an existing drifter, so the preview knows their total. */
  const match = useMemo(() => {
    const key = norm(name);
    return key ? drifters.find((d) => norm(d.drifter_name) === key) ?? null : null;
  }, [name, drifters]);

  const already = match?.bands ?? 0;
  const waitingList = useMemo(() => {
    const key = norm(name);
    return key ? entries.find((e) => e.active && e.submitted_at && !e.handed_over_at && norm(e.drifter_name) === key) ?? null : null;
  }, [name, entries]);
  const freeLeft = Math.max(0, allowance - already);

  /** What "+n" would cost this drifter right now. */
  function preview(n: number) {
    const free = Math.min(n, freeLeft);
    return { free, paid: n - free, charge: (n - free) * price };
  }
  const methodLabel = METHODS.find((m) => m.key === method)?.label ?? method;
  /** Payment is confirmed well enough to hand over charged bands. */
  const paymentOk = payReceived && (method === "cash" || payRef.trim().length >= 4);
  const payBlock = preview(6).paid > 0;
  const formRef = useRef<HTMLDivElement>(null);

  function tap(delta: number) {
    const trimmed = name.trim();
    if (!trimmed) { setError("Enter the drifter's name first."); return; }
    setError(null);
    setBusy(true);
    start(async () => {
      const r = await recordDrifterBands({
        ticketTypeId: type.id, drifterName: trimmed, team, delta, method, rulesAck,
        paymentConfirmed: payReceived, paymentRef: payRef,
      });
      if (!r.ok) setError(r.error);
      else if (r.result) {
        setRulesAck(false);
        setTeam("");
        setPayRef("");
        setPayReceived(false);
        const { drifter_name, total, free, paid, charge_centavos } = r.result;
        setFlash(
          delta > 0
            ? `${drifter_name}: +${delta} band${delta === 1 ? "" : "s"} (${free} free${paid > 0 ? `, ${paid} paid · ${php(charge_centavos)} received ${method === "cash" ? "in cash" : `via ${methodLabel}${payRef.trim() ? ` ref ${payRef.trim()}` : ""}`}` : ""}) · ${total} total`
            : `${drifter_name}: ${delta} band${delta === -1 ? "" : "s"} returned · ${total} total`
        );
        setName("");
      }
      setBusy(false);
      router.refresh();
    });
  }

  /** Row "−": take one band back. Returning a band needs no confirmation or payment. */
  function takeBack(drifter: DrifterBandRow) {
    setError(null);
    setBusy(true);
    start(async () => {
      const r = await recordDrifterBands({ ticketTypeId: type.id, drifterName: drifter.drifter_name, team: drifter.team_name ?? undefined, delta: -1, method, rulesAck: false });
      if (!r.ok) setError(r.error);
      else if (r.result) setFlash(`${r.result.drifter_name}: -1 · ${r.result.total} total`);
      setBusy(false);
      router.refresh();
    });
  }

  /**
   * Row "+ Add": open the desk form filled in for this drifter. Adding always goes
   * through the form, so the rules are read to whoever is at the desk and any band
   * past the free ones is paid for first.
   */
  function openDeskFor(drifter: DrifterBandRow) {
    setName(drifter.drifter_name);
    setTeam(drifter.team_name ?? "");
    setRulesAck(false);
    setPayReceived(false);
    setPayRef("");
    setError(null);
    setDeskOpen(true);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="space-y-5">
      {/* the label itself: colour, price, free allowance, stock */}
      <div className="card flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-md bg-white/10 text-lg font-black">{type.code}</span>
          <div>
            <div className="font-semibold leading-tight">{type.name}</div>
            <BandSwatch color={type.band_color} className="text-xs text-zinc-400" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">Free per drifter</div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-black tabular-nums">{allowance}</span>
              {isAdmin && (
                <InlineNumber
                  value={String(allowance)}
                  unit="bands"
                  label={`Free bands per drifter for ${type.name}`}
                  onSave={(raw) => setDrifterAllowance(type.id, Number(raw))}
                />
              )}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">Price past {allowance}</div>
            <div className="flex items-center gap-2">
              <span className={`text-xl font-black ${price <= 0 ? "text-amber-300" : ""}`}>{price > 0 ? php(price) : "No price"}</span>
              {isAdmin && (
                <InlineNumber
                  value={String(price / 100)}
                  unit={LOCALE.currencyCode}
                  label={`Price for extra ${type.name} bands`}
                  onSave={(raw) => setWalkinPrice(type.id, Number(raw))}
                />
              )}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">Bands left</div>
            <div className={`text-xl font-black tabular-nums ${left <= 20 ? "text-rose-400" : ""}`}>{left}</div>
          </div>
        </div>
      </div>

      {poolTotal === 0 && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
          No <b>{type.band_color}</b> wristband serials have been imported yet, so nothing can be handed out.{" "}
          {isAdmin
            ? <Link prefetch={false} href={`/admin/numbers?type=${type.id}`} className="underline">Import them on the Numbers page</Link>
            : "Ask an admin to import them on the Numbers page"}.
        </p>
      )}

      <DrifterQueue
        entries={entries}
        allowance={allowance}
        priceCentavos={price}
        alreadyOut={Object.fromEntries(drifters.map((d) => [d.drifter_name.trim().toLowerCase(), d.bands]))}
      />

      {/* hand bands to a drifter who did not pre-register */}
      <div ref={formRef} className="card space-y-4 p-4">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 text-left"
          onClick={() => setDeskOpen((v) => !v)}
          aria-expanded={deskOpen}
          aria-controls="desk-handout"
        >
          <span>
            <span className="block font-semibold">Hand out at the desk</span>
            <span className="block text-xs text-zinc-500">For a drifter who did not send in a list, or who needs more bands on the day.</span>
          </span>
          <span aria-hidden className={`shrink-0 text-zinc-400 transition-transform ${deskOpen ? "rotate-180" : ""}`}>&#9662;</span>
        </button>
        <div id="desk-handout" hidden={!deskOpen} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="drifter-name">Drifter (competing driver)</label>
            <input
              id="drifter-name"
              className="input mt-1"
              list="drifter-names"
              placeholder="e.g. Juan Dela Cruz"
              autoComplete="off"
              value={name}
              onChange={(e) => {
                const v = e.target.value;
                setName(v);
                setError(null);
                setRulesAck(false);
                // A drifter already on the list brings their team with them, so staff
                // confirm it rather than retype it.
                const key = norm(v);
                const known = key ? drifters.find((d) => norm(d.drifter_name) === key) : null;
                if (known?.team_name) setTeam(known.team_name);
              }}
              aria-describedby="drifter-hint"
            />
            <datalist id="drifter-names">
              {drifters.map((d) => <option key={d.drifter_key} value={d.drifter_name} />)}
            </datalist>
            <p id="drifter-hint" className="mt-1 text-xs text-zinc-500">
              {match
                ? <>{match.drifter_name}{match.team_name ? ` (${match.team_name})` : ""} already has <b>{already}</b> band{already === 1 ? "" : "s"} &middot; {freeLeft > 0 ? <>{freeLeft} free left</> : <span className="text-amber-300">free allowance used up, next bands cost {php(price)} each</span>}</>
                : <>Everyone with the team is booked under the drifter&apos;s name. The first {allowance} bands are free; extra bands are {php(price)} each.</>}
            </p>
          </div>
          <div>
            <label className="label" htmlFor="drifter-team">Team</label>
            <input
              id="drifter-team"
              className="input mt-1"
              list="drifter-teams"
              placeholder="e.g. Team Burnout"
              autoComplete="off"
              value={team}
              onChange={(e) => { setTeam(e.target.value); setError(null); }}
              aria-describedby="drifter-team-hint"
            />
            <datalist id="drifter-teams">
              {[...new Set(drifters.map((d) => d.team_name).filter(Boolean))].map((t) => <option key={t as string} value={t as string} />)}
            </datalist>
            <p id="drifter-team-hint" className="mt-1 text-xs text-zinc-500">Leave blank for a privateer.</p>
          </div>
        </div>
        {waitingList && (
          <p className="rounded-lg border border-cyan-400/40 bg-cyan-400/10 p-2 text-xs text-cyan-200">
            {waitingList.drifter_name} already sent in a list of {waitingList.band_count} through their link. Use <b>Hand over</b> in
            Pre-registered lists above instead of typing it again.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Extra bands paid by</span>
          <div className="inline-flex rounded-lg border border-white/15 bg-black/30 p-0.5">
            {METHODS.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setMethod(m.key)}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${method === m.key ? "bg-white/[0.12] text-white ring-1 ring-inset ring-cyan-300/70" : "text-white/75 hover:bg-white/10"}`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <span className="text-xs text-zinc-500">Ignored while the bands are still free.</span>
        </div>

        {payBlock && (
          <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-amber-200">Payment for bands past the free {allowance}</div>
            {method !== "cash" && (
              <input
                id="drifter-pay-ref"
                className="input sm:w-72"
                placeholder={`${methodLabel} reference number`}
                value={payRef}
                onChange={(e) => { setPayRef(e.target.value); setError(null); }}
                aria-label={`${methodLabel} reference number`}
              />
            )}
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-400"
                checked={payReceived}
                onChange={(e) => { setPayReceived(e.target.checked); setError(null); }}
              />
              <span className="text-amber-50">
                I received the payment for the extra bands {method === "cash" ? "in cash" : `via ${methodLabel} and checked it in the account`}.
              </span>
            </label>
            <p className="text-xs text-zinc-400">
              The amount is on each button below. Paid bands cannot be handed over until this is ticked
              {method !== "cash" ? " and the reference number is in" : ""}.
            </p>
          </div>
        )}

        {/* Read to the drifter before anything is handed over. */}
        <div className="rounded-lg border border-white/15 bg-black/30 p-3">
          <RulesHeading as="h3" />

          <ol className="mt-3 space-y-3 text-sm">
            {drifterRules(allowance, php(price), "desk").map((rule, i) => (
              <li key={i} className="border-l-2 border-white/15 pl-3">
                <RuleLines lines={rule} strong="text-white/90" />
              </li>
            ))}
          </ol>

          <label className={`mt-3 block cursor-pointer rounded-md border p-3 transition ${rulesAck ? "border-emerald-500/40 bg-emerald-500/10" : "border-amber-500/40 bg-amber-500/10"}`}>
            <span className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-400"
                checked={rulesAck}
                onChange={(e) => { setRulesAck(e.target.checked); setError(null); }}
              />
              <span className={`text-xs font-semibold uppercase tracking-wide ${rulesAck ? "text-emerald-200" : "text-amber-200"}`}>
                Confirmation by the drifter
              </span>
            </span>
            <span className="mt-2 block text-sm sm:pl-6">
              <RuleLines lines={DRIFTER_CONFIRMATION} strong={rulesAck ? "text-emerald-100" : "text-amber-100"} />
            </span>
          </label>
          {!rulesAck && <p className="mt-1 text-xs text-zinc-500">The drifter confirms this in front of you. Nothing can be handed over until it is ticked.</p>}
        </div>

        <div className="flex flex-wrap items-stretch gap-2">
          {[1, 2, 6].map((n) => {
            const p = preview(n);
            return (
              <button
                key={n}
                type="button"
                title={!rulesAck ? "Tick the confirmation above first" : p.paid > 0 && !paymentOk ? "Confirm the payment for the extra bands first" : undefined}
                className="btn-primary h-16 min-w-28 flex-1 px-4"
                disabled={busy || !rulesAck || !name.trim() || left < n || (p.paid > 0 && (price <= 0 || !paymentOk))}
                onClick={() => tap(n)}
                aria-label={`Hand over ${n} band${n === 1 ? "" : "s"}${p.paid > 0 ? `, ${php(p.charge)} to pay` : ", free"}`}
              >
                <span className="block text-xl font-black leading-tight">+{n}</span>
                <span className="block text-[10px] font-semibold uppercase tracking-wide opacity-80">
                  {p.paid === 0 ? "free" : p.free > 0 ? `${p.free} free + ${php(p.charge)}` : php(p.charge)}
                </span>
              </button>
            );
          })}
          <button
            type="button"
            className="btn-secondary h-16 w-16 shrink-0 text-2xl font-black"
            disabled={busy || !match || already <= 0}
            onClick={() => tap(-1)}
            aria-label="Take back one band from this drifter"
            title={match ? `Take back one band from ${match.drifter_name}` : "Type an existing drifter's name to undo"}
          >
            &minus;
          </button>
        </div>

        {error && <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</p>}
        </div>
        {flash && !error && <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs text-emerald-300">Recorded: {flash}</p>}
      </div>

      {/* running totals */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card p-4"><div className="text-[10px] uppercase tracking-wide text-zinc-500">Drifters</div><div className="text-2xl font-black tabular-nums">{totals.families}</div></div>
        <div className="card p-4">
          <div className="text-[10px] uppercase tracking-wide text-zinc-500">Bands handed out</div>
          <div className="text-2xl font-black tabular-nums">{totals.bands}</div>
          <div className="text-xs text-zinc-500">
            {totals.gate} here ({totals.free} free &middot; {totals.paid} paid)
            {totals.viaOrders > 0 && <> &middot; {totals.viaOrders} via orders</>}
          </div>
        </div>
        <div className="card p-4"><div className="text-[10px] uppercase tracking-wide text-zinc-500">Collected</div><div className="text-2xl font-black">{php(totals.amount)}</div><div className="text-xs text-zinc-500">gate charges and converted orders</div></div>
        <div className="card p-4"><div className="text-[10px] uppercase tracking-wide text-zinc-500">Bands left</div><div className={`text-2xl font-black tabular-nums ${left <= 20 ? "text-rose-400" : ""}`}>{left}</div><div className="text-xs text-zinc-500">of {poolTotal} imported</div></div>
      </div>

      {/* Bands that arrived through a converted order: paid for there, so they carry no
          free allowance and cannot be adjusted from this tab. */}
      {orderBands.length > 0 && (
        <div className="card overflow-x-auto">
          <h2 className="font-semibold">Issued through a converted order</h2>
          <p className="text-xs text-zinc-500">
            Already paid for in the order, so these do not use up anyone&apos;s free {allowance}. Adjust them on the order itself.
          </p>
          <table className={TABLE}>
            <thead className="text-left text-xs uppercase text-zinc-500">
              <tr>
                <th className="py-1">Order</th><th>Buyer</th><th className="hidden sm:table-cell">Wristband numbers</th>
                <th className="text-right">Bands</th><th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {orderBands.map((o) => {
                const range = o.numbers.length > 4 ? `${o.numbers[0]} – ${o.numbers[o.numbers.length - 1]}` : o.numbers.join(", ");
                return (
                  <tr key={o.order_id} className="border-t border-white/10">
                    <td className="py-2 font-semibold">
                      <Link prefetch={false} href={`/admin/orders/${o.order_id}`} className="text-cyan-300 hover:underline">#{o.order_no}</Link>
                    </td>
                    <td>
                      {o.buyer_name}
                      {/* on a phone the numbers ride under the buyer instead of taking a column */}
                      <div className="whitespace-nowrap font-mono text-xs text-zinc-400 sm:hidden">{range}</div>
                    </td>
                    <td className="hidden whitespace-nowrap font-mono text-xs text-zinc-400 sm:table-cell">{range}</td>
                    <td className="text-right font-bold tabular-nums">{o.numbers.length}</td>
                    <td className="whitespace-nowrap text-right tabular-nums">{php(o.amount_centavos)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        {/* one row per drifter family */}
        <div className="card overflow-x-auto">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Handed out here</h2>
          </div>
          {drifters.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-500">
              Nothing handed out at the gate yet.{orderBands.length > 0 && <> The {totals.viaOrders} band{totals.viaOrders === 1 ? "" : "s"} already out came through a converted order, listed above.</>}
            </p>
          ) : (
            // Rows on a shared grid rather than a table: on a phone the numbers fold into
            // one line under the name, so the name and the buttons both stay in view.
            <div className="mt-2 text-sm">
              <div className={`${HANDED_COLS} hidden pb-1 text-xs font-semibold uppercase text-zinc-500 sm:grid`}>
                <span>Drifter &amp; team</span>
                <span className="text-right">Bands</span>
                <span className="text-right">Free</span>
                <span className="text-right">Paid</span>
                <span className="text-right">Amount</span>
                <span aria-hidden />
              </div>
              <ul>
                {drifters.map((d) => (
                  <li key={d.drifter_key} className={`${HANDED_COLS} border-t border-white/10 py-2`}>
                    <div className="min-w-0">
                      <div className="truncate font-semibold" title={d.drifter_name}>{d.drifter_name}</div>
                      <div className="truncate text-xs text-zinc-500">{d.team_name ?? "no team"}</div>
                      <div className="text-xs text-zinc-400 sm:hidden">
                        <b className="text-white">{d.bands}</b> band{d.bands === 1 ? "" : "s"} &middot; <span className="text-emerald-300">{d.free_bands} free</span> &middot; {d.paid_bands} paid &middot; {php(Number(d.amount_centavos))}
                      </div>
                    </div>
                    <span className="hidden text-right font-bold tabular-nums sm:block">{d.bands}</span>
                    <span className="hidden text-right tabular-nums text-emerald-300 sm:block">{d.free_bands}</span>
                    <span className="hidden text-right tabular-nums sm:block">{d.paid_bands}</span>
                    <span className="hidden text-right tabular-nums sm:block">{php(Number(d.amount_centavos))}</span>
                    <span className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        className="btn-secondary h-8 w-8 px-0 py-0 text-base font-black"
                        disabled={busy || d.bands <= 0}
                        onClick={() => takeBack(d)}
                        title={`Take back one band from ${d.drifter_name}`}
                        aria-label={`Take back one band from ${d.drifter_name}`}
                      >
                        &minus;
                      </button>
                      <button
                        type="button"
                        className="btn-secondary h-8 w-16 whitespace-nowrap px-0 py-0 text-xs font-semibold"
                        disabled={busy || left <= 0}
                        onClick={() => openDeskFor(d)}
                        title={d.bands >= allowance ? `Past the free ${allowance}: the form takes the payment` : `Open the desk form for ${d.drifter_name}`}
                        aria-label={`Add bands for ${d.drifter_name}`}
                      >
                        + Add
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* audit-style feed of the taps */}
        <div className="card overflow-x-auto">
          <h2 className="font-semibold">Recent entries</h2>
          {recent.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-500">Nothing recorded yet.</p>
          ) : (
            // A list, not a table: this column is narrow, and six table cells made every
            // name wrap a word per line.
            <ul className="mt-2 text-sm">
              {recent.map((e) => {
                const paid = e.qty - e.free_qty;
                const time = new Date(e.created_at).toLocaleTimeString(LOCALE.locale, { timeZone: LOCALE.timeZone, hour: "numeric", minute: "2-digit" });
                const method = METHODS.find((m) => m.key === e.payment_method)?.label ?? e.payment_method;
                return (
                  <li key={e.id} className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-start gap-x-3 border-t border-white/10 py-2">
                    <span className={`pt-px text-right font-bold tabular-nums ${e.qty < 0 ? "text-rose-400" : "text-emerald-300"}`}>{e.qty > 0 ? `+${e.qty}` : e.qty}</span>
                    <div className="min-w-0">
                      <div className="truncate font-medium" title={e.drifter_name}>{e.drifter_name}</div>
                      <div className="truncate text-xs text-zinc-500">
                        {[e.team_name, time, e.staff].filter(Boolean).join(" \u00b7 ")}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="tabular-nums">{php(paid * e.unit_price_centavos)}</div>
                      <div className="whitespace-nowrap text-xs text-zinc-500">
                        {paid === 0 ? "free" : paid < 0 ? `${paid} paid` : (
                          <span className={e.payment_confirmed ? "text-emerald-300" : "text-amber-300"}>
                            {paid} paid{e.payment_confirmed ? " \u2713" : ""} &middot; {method}
                          </span>
                        )}
                      </div>
                      {paid > 0 && e.payment_ref && <div className="whitespace-nowrap font-mono text-[10px] text-zinc-500">ref {e.payment_ref}</div>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {isAdmin && <DrifterLinks entries={entries} siteUrl={siteUrl} signupSlug={type.drifter_signup_slug} />}
    </div>
  );
}
