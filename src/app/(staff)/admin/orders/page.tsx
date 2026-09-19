import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { OrderStatusBadge } from "@/components/StatusBadge";
import { php } from "@/lib/money";
import type { OrderStatus } from "@/lib/supabase/types";

const STATUSES: OrderStatus[] = ["awaiting_verification", "paid", "voided", "pending_payment", "rejected", "expired", "cancelled"];

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  await requireStaff("staff");
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
        <h1 className="text-2xl font-bold">Orders</h1>
        <a href="/api/admin/export" className="btn-secondary">Export CSV</a>
      </div>
      <form className="mt-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={q} className="input max-w-xs" placeholder="Name, email, mobile, reference, order #, ticket #" />
        <select name="status" defaultValue={status} className="input w-auto">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
        </select>
        <button className="btn-primary">Search</button>
      </form>

      <div className="card mt-4 overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500">
            <tr><th className="p-3">Order</th><th>Buyer</th><th>Channel</th><th>Payment</th><th className="text-right">Total</th><th>Status</th><th>Created</th></tr>
          </thead>
          <tbody>
            {(orders ?? []).map((o) => (
              <tr key={o.id} className="border-t hover:bg-zinc-50">
                <td className="p-3"><Link href={`/admin/orders/${o.id}`} className="font-semibold underline">#{o.order_no}</Link></td>
                <td><div>{o.buyer_name}</div><div className="text-xs text-zinc-500">{o.buyer_email} {o.buyer_mobile}</div></td>
                <td className="text-zinc-600">{o.channel}</td>
                <td className="text-xs"><span className="uppercase">{o.payment_method}</span> <span className="font-mono text-zinc-500">{o.payment_reference}</span></td>
                <td className="text-right">{php(o.total_centavos)}</td>
                <td><OrderStatusBadge status={o.status} /></td>
                <td className="text-xs text-zinc-500">{new Date(o.created_at).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}</td>
              </tr>
            ))}
            {(orders ?? []).length === 0 && <tr><td colSpan={7} className="p-6 text-center text-zinc-500">No orders match.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
