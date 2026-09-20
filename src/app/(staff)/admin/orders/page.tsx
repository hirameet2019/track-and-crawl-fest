import { requireStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { LiveOrders } from "@/components/LiveOrders";
import { OrdersTable, type OrderRow } from "@/components/OrdersTable";
import type { OrderStatus } from "@/lib/supabase/types";

const STATUSES: OrderStatus[] = ["awaiting_verification", "paid", "voided", "pending_payment", "rejected", "expired", "cancelled"];

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const session = await requireStaff("staff");
  const isAdmin = session.staff.role === "admin";
  const { q = "", status = "" } = await searchParams;
  const admin = createAdminClient();

  let query = admin
    .from("orders")
    .select("id, order_no, buyer_name, buyer_email, buyer_mobile, total_centavos, status, channel, payment_method, payment_reference, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (status) query = query.eq("status", status as OrderStatus);
  if (q.trim()) {
    const s = q.trim();
    const asNo = Number(s);
    // Ticket number search: find the order that owns that wristband
    const { data: byTicket } = await admin.from("tickets").select("order_id").ilike("number", `%${s}%`).limit(50);
    const ids = (byTicket ?? []).map((t) => t.order_id);
    const ors = [
      `buyer_name.ilike.%${s}%`,
      `buyer_email.ilike.%${s}%`,
      `buyer_mobile.ilike.%${s}%`,
      `payment_reference.ilike.%${s}%`,
      ...(Number.isInteger(asNo) ? [`order_no.eq.${asNo}`, `receipt_no.eq.${asNo}`] : []),
      ...(ids.length ? [`id.in.(${ids.join(",")})`] : []),
    ];
    query = query.or(ors.join(","));
  }
  const { data: orders } = await query;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3"><h1 className="text-2xl font-bold">Orders</h1><LiveOrders /></div>
        <div className="flex gap-2">
          <a href="/api/admin/export" className="btn-secondary" title="Excel: Summary plus one colour-coded sheet per wristband label">Export Excel</a>
          <a href="/api/admin/export?type=csv" className="btn-secondary" title="Flat CSV, one row per ticket">CSV</a>
        </div>
      </div>
      <form className="mt-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={q} className="input max-w-xs" placeholder="Name, email, mobile, reference, order #, ticket #" />
        <select name="status" defaultValue={status} className="input w-auto">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
        </select>
        <button className="btn-primary">Search</button>
      </form>

      <p className="mt-3 text-xs text-zinc-500">Tap a row to open the order here. Nothing else loads until you do.</p>
      <OrdersTable rows={(orders ?? []) as OrderRow[]} isAdmin={isAdmin} />
    </div>
  );
}
