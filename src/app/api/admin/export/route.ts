import { NextResponse, type NextRequest } from "next/server";
import { getStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { actionMeta, describe } from "@/lib/audit";
import { buildTicketsWorkbook } from "@/lib/export-xlsx";

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

type TallyRow = {
  created_at: string; qty: number; free_qty: number; drifter_name: string | null; unit_price_centavos: number; payment_method: string;
  ticket_type: { code: string; name: string; band_color: string | null; drifter_family: boolean } | null;
  staff: { full_name: string } | null;
};

async function tallyRows(): Promise<TallyRow[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("walkin_sales")
    .select("created_at, qty, free_qty, drifter_name, unit_price_centavos, payment_method, ticket_type:ticket_types(code, name, band_color, drifter_family), staff:staff(full_name)")
    .order("created_at")
    .limit(50000);
  return (data ?? []) as unknown as TallyRow[];
}

/** Bands given away inside a drifter's free allowance are never charged. */
const tallyAmount = (r: TallyRow) => (r.qty - r.free_qty) * r.unit_price_centavos;
const manilaTime = (iso: string) => new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila" });

/** Walk-in tally entries, one row per tap. Drifter family bands have their own export. */
async function walkinCsv() {
  const rows = (await tallyRows()).filter((r) => !r.drifter_name);
  return csv([
    ["time_manila", "code", "label", "band_color", "qty", "unit_price_php", "amount_php", "payment_method", "staff"],
    ...rows.map((r) => [
      manilaTime(r.created_at), r.ticket_type?.code, r.ticket_type?.name, r.ticket_type?.band_color,
      r.qty, (r.unit_price_centavos / 100).toFixed(2), (tallyAmount(r) / 100).toFixed(2), r.payment_method, r.staff?.full_name,
    ]),
  ]);
}

/**
 * Drifter family bands. Two blocks, because a band reaches a family two ways:
 * handed out at the gate (tallied per drifter) or issued by converting a paid
 * order. Only both together account for the bands missing from the pool.
 */
async function driftersCsv() {
  const admin = createAdminClient();
  const rows = (await tallyRows()).filter((r) => r.drifter_name);
  const byDrifter = new Map<string, { name: string; bands: number; free: number; amount: number }>();
  for (const r of rows) {
    const key = (r.drifter_name ?? "").toLowerCase();
    const d = byDrifter.get(key) ?? { name: r.drifter_name ?? "", bands: 0, free: 0, amount: 0 };
    d.bands += r.qty;
    d.free += r.free_qty;
    d.amount += tallyAmount(r);
    byDrifter.set(key, d);
  }
  return csv([
    ["drifter", "bands", "free_bands", "charged_bands", "amount_php"],
    ...[...byDrifter.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((d) => [d.name, d.bands, d.free, d.bands - d.free, (d.amount / 100).toFixed(2)]),
    [],
    ["time_manila", "drifter", "qty", "free_qty", "charged_qty", "unit_price_php", "amount_php", "payment_method", "staff"],
    ...rows.map((r) => [
      manilaTime(r.created_at), r.drifter_name, r.qty, r.free_qty, r.qty - r.free_qty,
      (r.unit_price_centavos / 100).toFixed(2), (tallyAmount(r) / 100).toFixed(2), r.payment_method, r.staff?.full_name,
    ]),
    [],
    ["issued through a converted order"],
    ["order_no", "buyer", "holder", "wristband_no", "status", "unit_price_php"],
    ...(await orderBandRows(admin)),
  ]);
}

/** One row per wristband issued out of a drifter label by an order conversion. */
async function orderBandRows(admin: ReturnType<typeof createAdminClient>) {
  const { data: types } = await admin.from("ticket_types").select("id").eq("drifter_family", true);
  const ids = (types ?? []).map((t) => t.id as string);
  if (ids.length === 0) return [];
  const [{ data: tickets }, { data: lines }] = await Promise.all([
    admin
      .from("tickets")
      .select("number, holder_name, status, order_id, order:orders(order_no, buyer_name)")
      .in("ticket_type_id", ids)
      .in("status", ["issued", "redeemed"])
      .order("number"),
    admin.from("order_items").select("order_id, unit_price_centavos").in("ticket_type_id", ids),
  ]);
  type Row = { number: string; holder_name: string | null; status: string; order_id: string; order: { order_no: number; buyer_name: string } | null };
  const price = new Map((lines ?? []).map((l) => [l.order_id as string, Number(l.unit_price_centavos)]));
  return ((tickets ?? []) as unknown as Row[]).map((t) => [
    t.order?.order_no, t.order?.buyer_name, t.holder_name, t.number, t.status,
    ((price.get(t.order_id) ?? 0) / 100).toFixed(2),
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

/**
 * Exports. `?type=walkin` (CSV) for the gate tally, `?type=drifters` (CSV) for the
 * drifter family bands, `?type=audit` (CSV, admin) for the audit
 * trail, `?type=csv` for the flat one-row-per-ticket CSV. Default is the Excel workbook with
 * a Summary sheet and one colour-coded sheet per wristband label. Staff only.
 */
export async function GET(req: NextRequest) {
  const session = await getStaff();
  if (!session || session.staff.role === "scanner") return new NextResponse("Forbidden", { status: 403 });
  const type = req.nextUrl.searchParams.get("type");
  if (type === "walkin") return download(await walkinCsv(), "walkin-tally");
  if (type === "drifters") return download(await driftersCsv(), "drifter-family-bands");
  if (type === "audit") {
    if (session.staff.role !== "admin") return new NextResponse("Forbidden", { status: 403 });
    return download(await auditCsv(), "audit-log");
  }

  if (type !== "csv") {
    const xlsx = await buildTicketsWorkbook();
    return new NextResponse(new Uint8Array(xlsx), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="tickets-by-wristband-${new Date().toISOString().slice(0, 10)}.xlsx"`,
        "Cache-Control": "private, no-store",
      },
    });
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
