/* eslint-disable react-hooks/purity -- server component: rendered once per request, Date.now() is intentional */
import Link from "next/link";
import { LiveOrders } from "@/components/LiveOrders";
import { humanMinutes } from "@/lib/elapsed";
import { requireStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveEvent, getAvailability } from "@/lib/queries";
import { php } from "@/lib/money";
import { PAYMENT_CHANNELS } from "@/config/event";
import { BandSwatch } from "@/components/BandSwatch";

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card">
      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
      {sub && <div className="text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}

const manilaDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

export default async function DashboardPage() {
  await requireStaff("staff");
  const event = await getActiveEvent();
  if (!event) return <p>No active event. Run the seed.</p>;

  const admin = createAdminClient();
  const [availability, { data: paidOrders }, { data: walkins }, { count: queueCount }, { data: oldest }, { data: recent }, { data: voidRows }] = await Promise.all([
    getAvailability(event.id),
    admin.from("orders").select("id, total_centavos, payment_method, channel, paid_at").eq("status", "paid").eq("event_id", event.id),
    admin.from("walkin_sales").select("qty, unit_price_centavos, payment_method, created_at").eq("event_id", event.id),
    admin.from("orders").select("id", { count: "exact", head: true }).eq("status", "awaiting_verification"),
    admin.from("orders").select("proof_submitted_at").eq("status", "awaiting_verification").order("proof_submitted_at").limit(1).maybeSingle(),
    admin.from("orders").select("id, order_no, buyer_name, total_centavos, status, channel, created_at").order("created_at", { ascending: false }).limit(10),
    admin.from("v_order_void_deductions").select("order_id, void_tickets, void_centavos"),
  ]);

  // Partially voided paid orders: count only the tickets that are still valid.
  // (Fully voided orders are status 'voided' and are not in `paidOrders` at all.)
  const voidByOrder = new Map<string, number>();
  for (const v of voidRows ?? []) voidByOrder.set(v.order_id as string, Number(v.void_centavos));
  const paid = (paidOrders ?? []).map((o) => ({ ...o, total_centavos: Math.max(0, o.total_centavos - (voidByOrder.get(o.id) ?? 0)) }));
  const voidedCentavos = (paidOrders ?? []).reduce((s, o) => s + (voidByOrder.get(o.id) ?? 0), 0);
  const voidedTickets = (voidRows ?? []).filter((v) => (paidOrders ?? []).some((o) => o.id === v.order_id)).reduce((s, v) => s + Number(v.void_tickets), 0);
  const tally = walkins ?? [];
  const onlineRevenue = paid.reduce((s, o) => s + o.total_centavos, 0);
  const walkinRevenue = tally.reduce((s, w) => s + w.qty * w.unit_price_centavos, 0);
  const walkinCount = tally.reduce((s, w) => s + w.qty, 0);
  const byMethod = { gotyme: 0, gcash: 0, maya: 0, cash: 0 } as Record<string, number>;
  for (const o of paid) if (o.payment_method) byMethod[o.payment_method] = (byMethod[o.payment_method] ?? 0) + o.total_centavos;
  for (const w of tally) byMethod[w.payment_method] = (byMethod[w.payment_method] ?? 0) + w.qty * w.unit_price_centavos;
  // GoTyme and cash are the live channels; GCash / Maya tiles only appear if they ever took money.
  const methodTiles = (["gotyme", "cash", "gcash", "maya"] as const).filter((m) => m === "gotyme" || m === "cash" || byMethod[m] > 0);
  const sold = availability.reduce((s, a) => s + Number(a.sold), 0);
  const onlineSold = availability.reduce((s, a) => s + Number(a.online_sold), 0);
  const redeemed = availability.reduce((s, a) => s + Number(a.redeemed), 0);

  // Daily sales for the last 14 days (online paid + walk-in)
  const days = new Map<string, { online: number; walkin: number }>();
  for (let i = 13; i >= 0; i--) days.set(manilaDay(new Date(Date.now() - i * 86400000).toISOString()), { online: 0, walkin: 0 });
  for (const o of paid) {
    if (!o.paid_at) continue;
    const d = days.get(manilaDay(o.paid_at));
    if (d) d.online += o.total_centavos;
  }
  for (const w of tally) {
    const d = days.get(manilaDay(w.created_at));
    if (d) d.walkin += w.qty * w.unit_price_centavos;
  }
  const maxDay = Math.max(1, ...[...days.values()].map((d) => d.online + d.walkin));
  const oldestAgeMin = oldest?.proof_submitted_at ? Math.round((Date.now() - new Date(oldest.proof_submitted_at).getTime()) / 60000) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-3"><h1 className="text-2xl font-bold">{event.name}</h1><LiveOrders /></div>
          <p className="text-sm text-zinc-500">Sales dashboard</p>
        </div>
        <div className="flex gap-2">
          <Link prefetch={false} href="/admin/walkin" className="btn-secondary">Walk-in tally</Link>
          <Link prefetch={false} href="/admin/verify" className={`btn-primary ${queueCount ? "" : "opacity-60"}`}>
            Verify queue {queueCount ? <span className="rounded-full bg-amber-400 px-2 text-xs text-black">{queueCount}</span> : null}
          </Link>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Revenue (paid)" value={php(onlineRevenue + walkinRevenue)} sub={`${paid.length} online orders · ${walkinCount} walk-in bands${voidedCentavos ? ` · excludes ${php(voidedCentavos)} for ${voidedTickets} voided ticket${voidedTickets === 1 ? "" : "s"}` : ""}`} />
        <Stat label="Wristbands sold" value={String(sold)} sub={`${onlineSold} online · ${walkinCount} walk-in · ${redeemed} scanned at gate`} />
        <Stat label="Awaiting verification" value={String(queueCount ?? 0)} sub={oldestAgeMin != null ? `oldest ${humanMinutes(oldestAgeMin)}` : "queue empty"} />
        <Stat label="Walk-in vs online" value={`${php(walkinRevenue)} / ${php(onlineRevenue)}`} />
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
                  <td className="font-medium">{a.name}{!a.sell_online && <span className="ml-1 text-[10px] uppercase text-zinc-500">gate only</span>}</td>
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
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Sales, last 14 days</h2>
            <div className="flex gap-3 text-[10px] uppercase tracking-wide text-zinc-500">
              <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-cyan-300" />online</span>
              <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-fuchsia-400" />walk-in</span>
            </div>
          </div>
          <div className="mt-4 flex h-32 items-end gap-1">
            {[...days.entries()].map(([d, v]) => (
              <div key={d} className="flex flex-1 flex-col items-center gap-1" title={`${d}: online ${php(v.online)} · walk-in ${php(v.walkin)}`}>
                <div className="flex w-full flex-col justify-end" style={{ height: "100%" }}>
                  <div className="w-full rounded-t bg-fuchsia-400" style={{ height: `${(v.walkin / maxDay) * 100}%` }} />
                  <div className="w-full bg-cyan-300" style={{ height: `${Math.max(v.online + v.walkin > 0 ? 0 : 2, (v.online / maxDay) * 100)}%` }} />
                </div>
                <div className="text-[9px] text-zinc-400">{d.slice(8)}</div>
              </div>
            ))}
          </div>
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
