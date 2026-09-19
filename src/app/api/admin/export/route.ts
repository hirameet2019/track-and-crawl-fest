import { NextResponse, type NextRequest } from "next/server";
import { getStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { actionMeta, describe } from "@/lib/audit";

export const dynamic = "force-dynamic";

function csv(rows: (string | number | null | undefined)[][]): string {
  return rows
    .map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\r\n");
}

function download(body: string, name: string) {
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}

/** Walk-in tally entries, one row per tap. */
async function walkinCsv() {
  const admin = createAdminClient();
  const { data } = await admin
    .from("walkin_sales")
    .select("created_at, qty, unit_price_centavos, payment_method, ticket_type:ticket_types(code, name, band_color), staff:staff(full_name)")
    .order("created_at")
    .limit(50000);
  type Row = { created_at: string; qty: number; unit_price_centavos: number; payment_method: string; ticket_type: { code: string; name: string; band_color: string | null } | null; staff: { full_name: string } | null };
  const rows = (data ?? []) as unknown as Row[];
  return csv([
    ["time_manila", "code", "label", "band_color", "qty", "unit_price_php", "amount_php", "payment_method", "staff"],
    ...rows.map((r) => [
      new Date(r.created_at).toLocaleString("en-PH", { timeZone: "Asia/Manila" }), r.ticket_type?.code, r.ticket_type?.name, r.ticket_type?.band_color,
      r.qty, (r.unit_price_centavos / 100).toFixed(2), ((r.qty * r.unit_price_centavos) / 100).toFixed(2), r.payment_method, r.staff?.full_name,
    ]),
  ]);
}

/** Audit trail, newest first. Admin only. */
async function auditCsv() {
  const admin = createAdminClient();
  const [{ data }, { data: staff }] = await Promise.all([
    admin.from("audit_log").select("id, created_at, actor, action, entity, entity_id, data").order("created_at", { ascending: false }).limit(50000),
    admin.from("staff").select("id, full_name"),
  ]);
  const names = new Map((staff ?? []).map((s) => [s.id, s.full_name]));
  return csv([
    ["time_manila", "category", "action", "label", "actor", "entity", "entity_id", "summary", "data_json"],
    ...(data ?? []).map((r) => {
      const m = actionMeta(r.action);
      return [
        new Date(r.created_at).toLocaleString("en-PH", { timeZone: "Asia/Manila" }), m.cat, r.action, m.label,
        r.actor ? names.get(r.actor) ?? r.actor : "buyer/system", r.entity, r.entity_id, describe(r.action, r.data as Record<string, unknown> | null), r.data ? JSON.stringify(r.data) : "",
      ];
    }),
  ]);
}

/** CSV export. `?type=walkin` for the gate tally, `?type=audit` for the audit trail (admin); default is every ticket with its order. Staff only. */
export async function GET(req: NextRequest) {
  const session = await getStaff();
  if (!session || session.staff.role === "scanner") return new NextResponse("Forbidden", { status: 403 });
  const type = req.nextUrl.searchParams.get("type");
  if (type === "walkin") return download(await walkinCsv(), "walkin-tally");
  if (type === "audit") {
    if (session.staff.role !== "admin") return new NextResponse("Forbidden", { status: 403 });
    return download(await auditCsv(), "audit-log");
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from("tickets")
    .select(
      "number, status, holder_name, shirt_size, vehicle_plate, vehicle_model, vehicle_photo_path, companion_of, redeemed_at, ticket_type:ticket_types(code, name, band_color), order:orders(order_no, receipt_no, status, channel, buyer_name, buyer_email, buyer_mobile, total_centavos, payment_method, payment_reference, paid_at)",
    )
    .order("created_at")
    .limit(50000);

  type Row = {
    number: string; status: string; holder_name: string | null; shirt_size: string | null; vehicle_plate: string | null; vehicle_model: string | null; vehicle_photo_path: string | null; companion_of: string | null; redeemed_at: string | null;
    ticket_type: { code: string; name: string; band_color: string | null } | null;
    order: { order_no: number; receipt_no: number | null; status: string; channel: string; buyer_name: string; buyer_email: string | null; buyer_mobile: string | null; total_centavos: number; payment_method: string | null; payment_reference: string | null; paid_at: string | null } | null;
  };
  const rows = (data ?? []) as unknown as Row[];

  const out = csv([
    ["wristband_no", "code", "ticket_type", "band_color", "ticket_status", "holder", "shirt_size", "plate", "vehicle", "car_photo", "companion_of", "redeemed_at", "order_no", "receipt_no", "order_status", "channel", "buyer", "email", "mobile", "order_total_php", "payment_method", "reference", "paid_at"],
    ...rows.map((t) => [
      t.number, t.ticket_type?.code, t.ticket_type?.name, t.ticket_type?.band_color, t.status, t.holder_name, t.shirt_size, t.vehicle_plate, t.vehicle_model, t.vehicle_photo_path ? "yes" : "", t.companion_of, t.redeemed_at,
      t.order?.order_no, t.order?.receipt_no, t.order?.status, t.order?.channel, t.order?.buyer_name, t.order?.buyer_email, t.order?.buyer_mobile,
      t.order ? (t.order.total_centavos / 100).toFixed(2) : "", t.order?.payment_method, t.order?.payment_reference, t.order?.paid_at,
    ]),
  ]);

  return download(out, "tickets");
}
