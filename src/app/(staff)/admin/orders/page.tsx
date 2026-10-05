import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { LiveOrders } from "@/components/LiveOrders";
import { OrdersTable, type OrderRow } from "@/components/OrdersTable";
import { php } from "@/lib/money";
import { getActiveEvent, getTicketTypes } from "@/lib/queries";
import type { OrderStatus } from "@/lib/supabase/types";

const STATUSES: OrderStatus[] = ["awaiting_verification", "paid", "voided", "pending_payment", "rejected", "expired", "cancelled"];

/** Money is in. */
const PAID: OrderStatus[] = ["paid"];
/** Money is still expected: a proof is waiting to be checked, or the buyer's timer is still running. */
const UNPAID: OrderStatus[] = ["awaiting_verification", "pending_payment"];
/** Never going to pay. Kept separate so the three groups add up to the whole list. */
const DROPPED: OrderStatus[] = ["expired", "rejected", "cancelled"];

const LIST_LIMIT = 200;
const PAGE = 1000;

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; type?: string }> }) {
  const session = await requireStaff("staff");
  const isAdmin = session.staff.role === "admin";
  const { q = "", status = "", type: typeParam = "" } = await searchParams;
  const admin = createAdminClient();

  // Wristband filter: the labels an order can hold (sold online, or reached through a
  // converted order like Drifter Family). Gate-only labels never appear in orders.
  const event = await getActiveEvent();
  const wristbands = event ? (await getTicketTypes(event.id)).filter((t) => t.sell_online || t.drifter_family) : [];
  const typeRow = wristbands.find((t) => t.id === typeParam) ?? null;
  const type = typeRow?.id ?? "";

  // Ticket-number search runs once and feeds both queries below.
  const s = q.trim();
  let ticketOrderIds: string[] = [];
  if (s) {
    const { data: byTicket } = await admin.from("tickets").select("order_id").ilike("number", `%${s}%`).limit(50);
    ticketOrderIds = (byTicket ?? []).map((t) => t.order_id);
  }
  const orFilter = s
    ? [
        `buyer_name.ilike.%${s}%`,
        `buyer_email.ilike.%${s}%`,
        `buyer_mobile.ilike.%${s}%`,
        `payment_reference.ilike.%${s}%`,
        ...(Number.isInteger(Number(s)) ? [`order_no.eq.${Number(s)}`, `receipt_no.eq.${Number(s)}`] : []),
        ...(ticketOrderIds.length ? [`id.in.(${ticketOrderIds.join(",")})`] : []),
      ].join(",")
    : null;

  /**
   * The search, status and wristband filters, applied identically to the list and to
   * the totals. The wristband filter is an inner join: only orders holding that label
   * come back, each with just its lines of that label.
   */
  const filtered = (columns: string) => {
    let qb = admin.from("orders").select(type ? `${columns}, order_items!inner(ticket_type_id, qty, unit_price_centavos)` : columns);
    if (status) qb = qb.eq("status", status as OrderStatus);
    if (orFilter) qb = qb.or(orFilter);
    if (type) qb = qb.eq("order_items.ticket_type_id", type);
    return qb;
  };

  // The table shows the newest 200. The totals must cover every matching order, not
  // just that page, so they are counted separately and paged through in full.
  const listPromise = filtered(
    "id, order_no, buyer_name, buyer_email, buyer_mobile, total_centavos, status, channel, payment_method, payment_reference, created_at",
  )
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);

  async function fetchAllForTotals() {
    const rows: {
      id: string; status: OrderStatus; total_centavos: number;
      /** Only with the wristband filter: this order's lines of that label. */
      order_items?: { qty: number; unit_price_centavos: number }[];
    }[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data } = await filtered("id, status, total_centavos")
        .order("created_at", { ascending: false })
        .range(from, from + PAGE - 1);
      const page = (data ?? []) as unknown as typeof rows;
      rows.push(...page);
      if (page.length < PAGE) break;
    }
    return rows;
  }

  const [{ data: orders }, totalRows, { data: voidRows }] = await Promise.all([
    listPromise,
    fetchAllForTotals(),
    admin.from("v_order_void_deductions").select("order_id, void_centavos"),
  ]);

  // A paid order with some tickets voided is worth less than its original total.
  // The dashboard nets the same way, so the two pages agree.
  const voidByOrder = new Map((voidRows ?? []).map((v) => [v.order_id as string, Number(v.void_centavos)]));

  const group = (statuses: OrderStatus[]) => {
    const rows = totalRows.filter((o) => statuses.includes(o.status));
    const gross = rows.reduce((sum, o) => sum + o.total_centavos, 0);
    const deducted = rows.reduce((sum, o) => sum + Math.min(o.total_centavos, voidByOrder.get(o.id) ?? 0), 0);
    return { count: rows.length, centavos: gross - deducted, deducted };
  };

  const paid = group(PAID);
  const unpaid = group(UNPAID);
  const dropped = group(DROPPED);
  const forVerification = group(["awaiting_verification"]);
  const awaitingPayment = group(["pending_payment"]);
  const voided = group(["voided"]);

  // The tiles total whole orders. With a wristband filter, also show that label's own
  // share of the paid ones: an order often holds other labels too.
  const typeShare = typeRow
    ? totalRows.filter((o) => o.status === "paid").reduce(
        (acc, o) => {
          for (const it of o.order_items ?? []) { acc.bands += it.qty; acc.centavos += it.qty * it.unit_price_centavos; }
          return acc;
        },
        { bands: 0, centavos: 0 },
      )
    : null;

  const filtering = Boolean(status || s || type);
  const scopeNote = filtering
    ? `Across the ${totalRows.length} order${totalRows.length === 1 ? "" : "s"} matching this search${typeRow ? ` (whole-order totals for orders with ${typeRow.name})` : ""}`
    : `Across all ${totalRows.length} orders`;
  const truncated = (orders?.length ?? 0) >= LIST_LIMIT && totalRows.length > LIST_LIMIT;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3"><h1 className="text-2xl font-bold">Orders</h1><LiveOrders /></div>
        <div className="flex gap-2">
          <a href="/api/admin/export" className="btn-secondary" title="Excel: Summary plus one colour-coded sheet per wristband label">Export Excel</a>
          <a href="/api/admin/export?type=csv" className="btn-secondary" title="Flat CSV, one row per ticket">CSV</a>
        </div>
      </div>

      {/* Side by side, the tiles share three rows (label, amount, note) so the amounts line up even when a label wraps. */}
      <div className="mt-4 grid gap-3 sm:grid-cols-3 sm:gap-y-0">
        <Total
          label="Paid"
          value={php(paid.centavos)}
          sub={`${paid.count} order${paid.count === 1 ? "" : "s"}${paid.deducted ? ` · ${php(paid.deducted)} in voided tickets taken out` : ""}`}
          tone="paid"
        />
        <Total
          label="Unpaid"
          value={php(unpaid.centavos)}
          sub={`${forVerification.count} for verification (${php(forVerification.centavos)}) · ${awaitingPayment.count} awaiting payment (${php(awaitingPayment.centavos)})`}
          tone="unpaid"
        />
        <Total
          label="Expired, rejected or cancelled"
          value={php(dropped.centavos)}
          sub={`${dropped.count} order${dropped.count === 1 ? "" : "s"} that will not be collected`}
          tone="dropped"
        />
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        {scopeNote}.{voided.count ? ` ${voided.count} voided order${voided.count === 1 ? "" : "s"} (${php(voided.centavos)}) are counted in none of the three.` : ""}
        {typeRow && typeShare && (
          <> {typeRow.name} itself in the paid ones: <b className="text-zinc-300">{typeShare.bands} band{typeShare.bands === 1 ? "" : "s"} · {php(typeShare.centavos)}</b>.</>
        )}
      </p>

      <form className="mt-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={q} className="input max-w-xs" placeholder="Name, email, mobile, reference, order #, ticket #" />
        <select name="status" defaultValue={status} className="input w-auto" aria-label="Order status">
          <option value="">All statuses</option>
          {STATUSES.map((st) => <option key={st} value={st}>{st.replace("_", " ")}</option>)}
        </select>
        <select name="type" defaultValue={type} className="input w-auto" aria-label="Wristband">
          <option value="">All wristbands</option>
          {wristbands.map((t) => (
            <option key={t.id} value={t.id}>{t.code} · {t.name}{t.band_color ? ` (${t.band_color})` : ""}</option>
          ))}
        </select>
        <button className="btn-primary">Search</button>
        {filtering && <Link prefetch={false} href="/admin/orders" className="btn-secondary">Clear</Link>}
      </form>

      <p className="mt-3 text-xs text-zinc-500">
        Tap a row to open the order here. Nothing else loads until you do.
        {truncated ? ` The table shows the newest ${LIST_LIMIT}; the totals above cover all ${totalRows.length}.` : ""}
      </p>
      <OrdersTable rows={(orders ?? []) as unknown as OrderRow[]} isAdmin={isAdmin} />
    </div>
  );
}

/** Money tile above the orders list. The tone is a left stripe, so the three read apart at a glance. */
function Total({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: "paid" | "unpaid" | "dropped" }) {
  const stripe =
    tone === "paid" ? "border-l-emerald-500" : tone === "unpaid" ? "border-l-amber-500" : "border-l-zinc-400";
  return (
    <div className={`card border-l-4 sm:row-span-3 sm:grid sm:grid-rows-subgrid ${stripe}`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs text-zinc-500">{sub}</div>
    </div>
  );
}
