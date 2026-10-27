/* eslint-disable react-hooks/purity -- server component: rendered once per request, Date.now() is intentional */
import { LOCALE } from "@/config/site";
import { fetchAll } from "@/lib/fetch-all";
import Link from "next/link";
import { LiveOrders } from "@/components/LiveOrders";
import { humanMinutes } from "@/lib/elapsed";
import { requireStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveEvent, getAvailability, getTicketTypes, hasDrifterLabel } from "@/lib/queries";
import { php } from "@/lib/money";
import { PAYMENT_CHANNELS } from "@/config/event";
import { BandSwatch } from "@/components/BandSwatch";

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card h-full">
      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}

const manilaDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: LOCALE.timeZone });

export default async function DashboardPage() {
  await requireStaff("staff");
  const event = await getActiveEvent();
  if (!event) return <p>No active event. Run the seed.</p>;
  // cached: the staff layout already asked, so this costs no extra query
  const drifters = await hasDrifterLabel(event.id);

  const admin = createAdminClient();
  // Labels hidden in Settings (hidden_in_admin) are left out of every figure here; their
  // orders and gate sales stay in the database.
  const hidden = new Set((await getTicketTypes(event.id)).filter((t) => t.hidden_in_admin).map((t) => t.id));
  const shownOrder = (lines: { ticket_type_id: string }[] | null | undefined) => !lines?.length || lines.some((l) => !hidden.has(l.ticket_type_id));
  type PaidLine = { id: string; order_id: string; ticket_type_id: string; qty: number; unit_price_centavos: number; order: { payment_method: string | null; created_at: string } };
  type VoidTicket = { order_id: string; ticket_type_id: string; included: boolean };
  type Pending = { proof_submitted_at: string | null; order_items: { ticket_type_id: string }[] };
  type Recent = { id: string; order_no: number; buyer_name: string; total_centavos: number; status: string; channel: string; created_at: string; order_items: { ticket_type_id: string }[] };
  const [availabilityAll, paidLines, paidVoids, walkins, { data: pendingRows }, { data: recentRows }] = await Promise.all([
    getAvailability(event.id),
    // Paged: one request stops at 1,000 rows, and the gate passed that on event day.
    fetchAll((from, to) =>
      admin.from("order_items").select("id, order_id, ticket_type_id, qty, unit_price_centavos, order:orders!inner(status, event_id, payment_method, created_at)")
        .eq("order.status", "paid").eq("order.event_id", event.id).order("id").range(from, to)).then((r) => r as unknown as PaidLine[]),
    fetchAll((from, to) =>
      admin.from("tickets").select("order_id, ticket_type_id, included, order:orders!inner(status, event_id)")
        .eq("status", "void").not("ticket_number_id", "is", null).eq("order.status", "paid").eq("order.event_id", event.id).order("id").range(from, to)).then((r) => r as unknown as VoidTicket[]),
    fetchAll((from, to) => admin.from("walkin_sales").select("ticket_type_id, qty, free_qty, drifter_name, unit_price_centavos, payment_method, created_at").eq("event_id", event.id).order("id").range(from, to)),
    admin.from("orders").select("proof_submitted_at, order_items(ticket_type_id)").eq("status", "awaiting_verification").order("proof_submitted_at"),
    admin.from("orders").select("id, order_no, buyer_name, total_centavos, status, channel, created_at, order_items(ticket_type_id)").order("created_at", { ascending: false }).limit(60),
  ]);
  const availability = availabilityAll.filter((a) => !hidden.has(a.ticket_type_id));
  const pending = ((pendingRows ?? []) as unknown as Pending[]).filter((o) => shownOrder(o.order_items));
  const queueCount = pending.length;
  const oldest = pending[0] ?? null;
  const recent = ((recentRows ?? []) as unknown as Recent[]).filter((o) => shownOrder(o.order_items)).slice(0, 10);

  // Each paid order is worth its lines of the labels shown here, less those labels'
  // voided tickets, each priced from its own line the way the database views do it
  // (the free passenger band at PHP 0). With nothing hidden this is the order total
  // less its void deductions, as before.
  const orderSums = new Map<string, { amount: number; voided: number; voidedTickets: number; payment_method: string | null; created_at: string }>();
  const linesOf = new Map<string, PaidLine[]>();
  for (const l of paidLines) {
    if (hidden.has(l.ticket_type_id)) continue;
    const o = orderSums.get(l.order_id) ?? { amount: 0, voided: 0, voidedTickets: 0, payment_method: l.order.payment_method, created_at: l.order.created_at };
    o.amount += l.qty * l.unit_price_centavos;
    orderSums.set(l.order_id, o);
    const k = `${l.order_id}|${l.ticket_type_id}`;
    linesOf.set(k, [...(linesOf.get(k) ?? []), l]);
  }
  for (const v of paidVoids) {
    const lines = linesOf.get(`${v.order_id}|${v.ticket_type_id}`);
    const o = orderSums.get(v.order_id);
    if (!lines || !o) continue;
    const line = [...lines].sort((a, b) =>
      Number((a.unit_price_centavos === 0) !== v.included) - Number((b.unit_price_centavos === 0) !== v.included)
      || b.unit_price_centavos - a.unit_price_centavos || a.id.localeCompare(b.id))[0];
    o.voided += line.unit_price_centavos;
    o.voidedTickets += 1;
  }
  // Partially voided paid orders: count only the tickets that are still valid.
  // (Fully voided orders are status 'voided' and are not paid at all.)
  const paid = [...orderSums.entries()].map(([id, o]) => ({ id, total_centavos: Math.max(0, o.amount - o.voided), payment_method: o.payment_method, created_at: o.created_at }));
  const voidedCentavos = [...orderSums.values()].reduce((s, o) => s + o.voided, 0);
  const voidedTickets = [...orderSums.values()].reduce((s, o) => s + o.voidedTickets, 0);
  const tally = walkins.filter((w) => !hidden.has(w.ticket_type_id));
  // Bands inside a drifter's free allowance are handed over, not sold: they count as
  // wristbands out but never as money. Gate taps and drifter hand-outs are also kept
  // apart so the organizer can see what the grid consumed.
  const amount = (w: { qty: number; free_qty: number; unit_price_centavos: number }) => (w.qty - w.free_qty) * w.unit_price_centavos;
  const gate = tally.filter((w) => !w.drifter_name);
  const drifterTally = tally.filter((w) => w.drifter_name);
  const onlineRevenue = paid.reduce((s, o) => s + o.total_centavos, 0);
  const walkinRevenue = gate.reduce((s, w) => s + amount(w), 0);
  const walkinCount = gate.reduce((s, w) => s + w.qty, 0);
  const drifterRevenue = drifterTally.reduce((s, w) => s + amount(w), 0);
  const drifterBands = drifterTally.reduce((s, w) => s + w.qty, 0);
  const drifterFree = drifterTally.reduce((s, w) => s + w.free_qty, 0);
  const byMethod = { gotyme: 0, gcash: 0, maya: 0, cash: 0 } as Record<string, number>;
  for (const o of paid) if (o.payment_method) byMethod[o.payment_method] = (byMethod[o.payment_method] ?? 0) + o.total_centavos;
  for (const w of tally) byMethod[w.payment_method] = (byMethod[w.payment_method] ?? 0) + amount(w);
  // GoTyme and cash are the live channels; GCash / Maya tiles only appear if they ever took money.
  const methodTiles = (["gotyme", "cash", "gcash", "maya"] as const).filter((m) => m === "gotyme" || m === "cash" || byMethod[m] > 0);
  const sold = availability.reduce((s, a) => s + Number(a.sold), 0);
  const onlineSold = availability.reduce((s, a) => s + Number(a.online_sold), 0);
  const redeemed = availability.reduce((s, a) => s + Number(a.redeemed), 0);

  // Daily sales for the last 14 days (online paid + walk-in). Online sales are placed on
  // the day the buyer ordered, not the day staff approved: approvals are done in batches,
  // so paid_at would pile a whole week of sales onto one bar.
  const days = new Map<string, { online: number; walkin: number }>();
  for (let i = 13; i >= 0; i--) days.set(manilaDay(new Date(Date.now() - i * 86400000).toISOString()), { online: 0, walkin: 0 });
  for (const o of paid) {
    const d = days.get(manilaDay(o.created_at));
    if (d) d.online += o.total_centavos;
  }
  for (const w of tally) {
    const d = days.get(manilaDay(w.created_at));
    if (d) d.walkin += amount(w);
  }
  const dayTotals = [...days.values()].map((d) => d.online + d.walkin);
  const maxDay = Math.max(1, ...dayTotals);
  const windowTotal = dayTotals.reduce((a, b) => a + b, 0);
  const dayLabel = (iso: string) => new Date(`${iso}T12:00:00${LOCALE.utcOffset}`).toLocaleDateString(LOCALE.locale, { timeZone: LOCALE.timeZone, month: "short", day: "numeric" });
  const oldestAgeMin = oldest?.proof_submitted_at ? Math.round((Date.now() - new Date(oldest.proof_submitted_at).getTime()) / 60000) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-3"><h1 className="text-2xl font-bold">{event.name}</h1><LiveOrders /></div>
          <p className="text-sm text-zinc-500">Sales dashboard{hidden.size ? ` · ${hidden.size} label${hidden.size === 1 ? "" : "s"} hidden in Settings left out of every figure` : ""}</p>
        </div>
        <div className="flex gap-2">
          <Link prefetch={false} href="/admin/walkin" className="btn-secondary">Walk-in tally</Link>
          {drifters && <Link prefetch={false} href="/admin/drifters" className="btn-secondary">Drifters</Link>}
          <Link prefetch={false} href="/admin/verify" className={`btn-primary ${queueCount ? "" : "opacity-60"}`}>
            Verify queue {queueCount ? <span className="rounded-full bg-amber-400 px-2 text-xs text-black">{queueCount}</span> : null}
          </Link>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Revenue (paid)" value={php(onlineRevenue + walkinRevenue + drifterRevenue)} sub={`${paid.length} online orders · ${walkinCount} walk-in bands${drifterRevenue ? ` · ${php(drifterRevenue)} drifter extras` : ""}${voidedCentavos ? ` · excludes ${php(voidedCentavos)} for ${voidedTickets} voided ticket${voidedTickets === 1 ? "" : "s"}` : ""}`} />
        <Stat label="Wristbands sold" value={String(sold)} sub={`${onlineSold} online · ${walkinCount} walk-in${drifterBands ? ` · ${drifterBands} drifter family (${drifterFree} free)` : ""} · ${redeemed} scanned at gate`} />
        <Stat label="Awaiting verification" value={String(queueCount ?? 0)} sub={oldestAgeMin != null ? `oldest ${humanMinutes(oldestAgeMin)}` : "queue empty"} />
        <div className="card">
          <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Walk-in vs online</div>
          <dl className="mt-1 grid grid-cols-2 gap-3">
            <div><dt className="text-xs text-zinc-500">Walk-in</dt><dd className="text-xl font-bold tabular-nums">{php(walkinRevenue)}</dd></div>
            <div><dt className="text-xs text-zinc-500">Online</dt><dd className="text-xl font-bold tabular-nums">{php(onlineRevenue)}</dd></div>
          </dl>
        </div>
      </div>

      <div className={`grid gap-3 ${methodTiles.length > 2 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        {methodTiles.map((m) => (
          <Stat
            key={m}
            label={PAYMENT_CHANNELS[m].label}
            value={php(byMethod[m])}
            sub={m === "cash" ? "reconcile vs cash box" : "online + gate, reconcile vs account history"}
          />
        ))}
      </div>

      <div className="card overflow-x-auto">
        <h2 className="font-semibold">Per wristband label</h2>
        <p className="text-xs text-zinc-500">Same order as the organizer&apos;s sheet. Left = free wristbands minus unpaid reservations minus walk-in taps.</p>
        <table className="mt-3 w-full text-sm">
          <thead className="text-left text-xs uppercase text-zinc-500">
            <tr><th className="py-1">Code</th><th>Label</th><th>Band</th><th className="text-right">Online</th><th className="text-right">Walk-in</th><th className="text-right">Reserved</th><th className="text-right">Left</th><th className="text-right">Pool</th><th className="text-right">Scanned</th><th className="text-right">Revenue</th><th className="w-36"></th></tr>
          </thead>
          <tbody>
            {availability.map((a) => {
              const pct = a.pool_total ? Math.round((Number(a.sold) / Number(a.pool_total)) * 100) : 0;
              return (
                <tr key={a.ticket_type_id} className="border-t">
                  <td className="py-2"><span className="rounded bg-white/10 px-1.5 py-0.5 font-black">{a.code}</span></td>
                  <td className="font-medium">{a.name}{a.pool_type_id && <span className="ml-1 text-[10px] uppercase text-zinc-500">{availability.find((x) => x.ticket_type_id === a.pool_type_id)?.code} bands</span>}{a.drifter_family ? <span className="ml-1 text-[10px] uppercase text-zinc-500">drifters</span> : !a.sell_online && <span className="ml-1 text-[10px] uppercase text-zinc-500">gate only</span>}</td>
                  <td className="text-zinc-500"><BandSwatch color={a.band_color} size={12} label={false} /> {a.band_color}</td>
                  <td className="text-right">{a.online_sold}</td>
                  <td className="text-right">{a.walkin_sold}</td>
                  <td className="text-right text-amber-700">{a.reserved}</td>
                  <td className={`text-right ${Number(a.sellable) <= 10 ? "font-semibold text-red-600" : ""}`}>{a.sellable}</td>
                  <td className="text-right text-zinc-500">{a.pool_total}</td>
                  <td className="text-right">{a.redeemed}</td>
                  <td className="text-right">{php(Number(a.revenue_centavos))}</td>
                  <td className="pl-3"><div className="h-2 rounded bg-zinc-100"><div className="h-2 rounded bg-zinc-900" style={{ width: `${pct}%` }} /></div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">Sales, last 14 days</h2>
            <div className="flex gap-3 text-[10px] uppercase tracking-wide text-zinc-500">
              <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-cyan-300" />online</span>
              <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-fuchsia-400" />on-site</span>
            </div>
          </div>
          <p className="mt-0.5 text-xs text-zinc-500">
            {php(windowTotal)} in paid orders &middot; tallest bar {php(maxDay)} &middot; counted on the day the order was placed
          </p>
          {/* The bar area needs a definite height of its own: percentage heights inside an
              auto-height column resolve to zero and the chart renders blank. */}
          <div className="mt-3 flex h-36 gap-1">
            {[...days.entries()].map(([d, v]) => {
              const total = v.online + v.walkin;
              return (
                <div key={d} className="flex min-w-0 flex-1 flex-col" title={`${dayLabel(d)}: online ${php(v.online)} · on-site ${php(v.walkin)} · total ${php(total)}`}>
                  <div className="flex flex-1 flex-col justify-end">
                    {v.walkin > 0 && <div className="w-full rounded-t bg-fuchsia-400" style={{ height: `${(v.walkin / maxDay) * 100}%` }} />}
                    {v.online > 0 && <div className={`w-full bg-cyan-300 ${v.walkin > 0 ? "" : "rounded-t"}`} style={{ height: `${(v.online / maxDay) * 100}%` }} />}
                    {total === 0 && <div className="h-px w-full bg-white/15" />}
                  </div>
                  <div className={`mt-1 text-center text-[9px] ${total > 0 ? "font-semibold text-white/75" : "text-zinc-500"}`}>{d.slice(8)}</div>
                </div>
              );
            })}
          </div>
          <p className="mt-1 text-center text-[10px] text-zinc-500">{dayLabel([...days.keys()][0])} to {dayLabel([...days.keys()][days.size - 1])} &middot; hover a bar for the amount</p>
        </div>
        <div className="card overflow-x-auto">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Recent online orders</h2>
            <Link prefetch={false} href="/admin/orders" className="text-sm underline">All orders</Link>
          </div>
          <table className="mt-3 w-full text-sm">
            <tbody>
              {(recent ?? []).map((o) => (
                <tr key={o.id} className="border-t">
                  <td className="py-1.5"><Link prefetch={false} href={`/admin/orders/${o.id}`} className="font-medium underline">#{o.order_no}</Link></td>
                  <td>{o.buyer_name}</td>
                  <td className="text-zinc-500">{o.channel}</td>
                  <td className="text-right">{php(o.total_centavos)}</td>
                  <td className="text-right text-xs text-zinc-500">{o.status.replace("_", " ")}</td>
                </tr>
              ))}
              {(recent ?? []).length === 0 && <tr><td className="py-3 text-center text-zinc-500">No orders yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
