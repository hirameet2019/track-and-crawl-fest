import { LOCALE } from "@/config/site";
import { fetchAll } from "@/lib/fetch-all";
import { shirtShips, shippingOneLine, type Shipping } from "@/lib/shipping";
import { NextResponse, type NextRequest } from "next/server";
import { can, getStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { actionMeta, describe } from "@/lib/audit";
import { buildTicketsWorkbook } from "@/lib/export-xlsx";
import { buildStaffSalesWorkbook } from "@/lib/export-staff-xlsx";

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
  created_at: string; qty: number; free_qty: number; drifter_name: string | null; team_name: string | null; rules_ack: boolean;
  payment_ref: string | null; payment_confirmed: boolean; unit_price_centavos: number; payment_method: string; shirt_size: string | null; holder_name: string | null; vehicle_plate: string | null;
  shipping: Shipping | null;
  ticket_type: { code: string; name: string; walkin_name: string | null; band_color: string | null; drifter_family: boolean } | null;
  staff: { full_name: string } | null;
};

async function tallyRows(): Promise<TallyRow[]> {
  const admin = createAdminClient();
  const data = await fetchAll((from, to) =>
    admin
      .from("walkin_sales")
      .select("created_at, qty, free_qty, drifter_name, team_name, rules_ack, payment_ref, payment_confirmed, unit_price_centavos, payment_method, shirt_size, holder_name, vehicle_plate, shipping, ticket_type:ticket_types(code, name, walkin_name, band_color, drifter_family), staff:staff(full_name)")
      .order("created_at")
      .order("id")
      .range(from, to),
  );
  return data as unknown as TallyRow[];
}

/** Bands given away free (a car's included passengers) are never charged. */
const tallyAmount = (r: TallyRow) => (r.qty - r.free_qty) * r.unit_price_centavos;
const manilaTime = (iso: string) => new Date(iso).toLocaleString(LOCALE.locale, { timeZone: LOCALE.timeZone });

/** Walk-in tally entries, one row per tap. */
async function walkinCsv() {
  // Rows from an old drift event's drifter desk are not gate sales.
  const rows = (await tallyRows()).filter((r) => !r.drifter_name);
  return csv([
    // sales = qty - free_qty: one band, or one car whose passenger bands are included
    ["time_manila", "code", "label", "band_color", "sales", "bands", "unit_price_php", "amount_php", "shirt_size", "name", "plate", "payment_method", "payment_ref", "staff", "ship_shirt_to"],
    ...rows.map((r) => [
      manilaTime(r.created_at), r.ticket_type?.code, r.ticket_type?.walkin_name ?? r.ticket_type?.name, r.ticket_type?.band_color,
      r.qty - r.free_qty, r.qty, (r.unit_price_centavos / 100).toFixed(2), (tallyAmount(r) / 100).toFixed(2), r.shirt_size ?? "", r.holder_name ?? "", r.vehicle_plate ?? "",
      r.payment_method, r.payment_ref ?? "", r.staff?.full_name, r.shipping ? shippingOneLine(r.shipping) : "",
    ]),
  ]);
}

/** Audit trail, newest first. Admin only. */
async function auditCsv() {
  const admin = createAdminClient();
  const [data, { data: staff }] = await Promise.all([
    fetchAll((from, to) => admin.from("audit_log").select("id, created_at, actor, action, entity, entity_id, data").order("created_at", { ascending: false }).order("id").range(from, to)),
    admin.from("staff").select("id, full_name"),
  ]);
  const names = new Map((staff ?? []).map((s) => [s.id, s.full_name]));
  return csv([
    ["time_manila", "category", "action", "label", "actor", "entity", "entity_id", "summary", "data_json"],
    ...(data ?? []).map((r) => {
      const m = actionMeta(r.action);
      return [
        new Date(r.created_at).toLocaleString(LOCALE.locale, { timeZone: LOCALE.timeZone }), m.cat, r.action, m.label,
        r.actor ? names.get(r.actor) ?? r.actor : "buyer/system", r.entity, r.entity_id, describe(r.action, r.data as Record<string, unknown> | null), r.data ? JSON.stringify(r.data) : "",
      ];
    }),
  ]);
}

/**
 * Exports. `?type=walkin` (CSV) for the gate tally, `?type=audit` (CSV, admin) for
 * the audit trail, `?type=csv` for the flat one-row-per-ticket CSV. Default is the
 * Excel workbook with a Summary sheet and one sheet per ticket type. Staff only.
 */
export async function GET(req: NextRequest) {
  const session = await getStaff();
  const type = req.nextUrl.searchParams.get("type");
  // The gate desk gets its own tally (counts only, no buyers), the audit trail needs
  // Audit, the per-staff workbook Reports. Everything else holds buyer names and
  // contacts, so it needs Orders.
  if (!session || !can(session, type === "walkin" ? "walkin" : type === "audit" ? "audit" : type === "staff" ? "reports" : "orders")) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  if (type === "walkin") return download(await walkinCsv(), "walkin-tally");
  if (type === "audit") return download(await auditCsv(), "audit-log");

  // Walk-in cash per staff account (labels hidden in Settings left out): for the organizer's admins, like the Reports page it sits on.
  if (type === "staff") {
    const xlsx = await buildStaffSalesWorkbook();
    return new NextResponse(new Uint8Array(xlsx), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="walk-in-sales-by-staff-${new Date().toISOString().slice(0, 10)}.xlsx"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  if (type !== "csv") {
    const xlsx = await buildTicketsWorkbook();
    return new NextResponse(new Uint8Array(xlsx), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="tickets-by-type-${new Date().toISOString().slice(0, 10)}.xlsx"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  const admin = createAdminClient();
  const data = await fetchAll((from, to) =>
    admin
      .from("tickets")
      .select(
        "number, status, holder_name, shirt_size, vehicle_plate, vehicle_model, vehicle_photo_path, companion_of, included, redeemed_at, ticket_type:ticket_types(code, name, band_color, ships_shirt), order:orders(order_no, receipt_no, status, channel, buyer_name, buyer_email, buyer_mobile, total_centavos, payment_method, payment_channel_label, payment_reference, paid_at, shipping)",
      )
      .order("created_at")
      .order("id")
      .range(from, to),
  );

  type Row = {
    number: string; status: string; holder_name: string | null; shirt_size: string | null; vehicle_plate: string | null; vehicle_model: string | null; vehicle_photo_path: string | null; companion_of: string | null; included: boolean; redeemed_at: string | null;
    ticket_type: { code: string; name: string; band_color: string | null; ships_shirt: boolean } | null;
    order: { order_no: number; receipt_no: number | null; status: string; channel: string; buyer_name: string; buyer_email: string | null; buyer_mobile: string | null; total_centavos: number; payment_method: string | null; payment_channel_label?: string | null; payment_reference: string | null; paid_at: string | null; shipping: Shipping | null } | null;
  };
  const rows = (data ?? []) as unknown as Row[];

  const out = csv([
    ["number", "code", "ticket_type", "band_color", "ticket_status", "holder", "shirt_size", "plate", "vehicle", "car_photo", "companion_of", "ship_shirt_to", "redeemed_at", "order_no", "receipt_no", "order_status", "channel", "buyer", "email", "mobile", "order_total_php", "payment_method", "reference", "paid_at"],
    ...rows.map((t) => [
      t.number, t.ticket_type?.code, t.ticket_type?.name, t.ticket_type?.band_color, t.status, t.holder_name, t.shirt_size, t.vehicle_plate, t.vehicle_model, t.vehicle_photo_path ? "yes" : "", t.companion_of,
      !t.included && shirtShips(t.ticket_type, t.order) ? shippingOneLine(t.order!.shipping!) : "", t.redeemed_at,
      t.order?.order_no, t.order?.receipt_no, t.order?.status, t.order?.channel, t.order?.buyer_name, t.order?.buyer_email, t.order?.buyer_mobile,
      t.order ? (t.order.total_centavos / 100).toFixed(2) : "", t.order?.payment_channel_label ?? t.order?.payment_method, t.order?.payment_reference, t.order?.paid_at,
    ]),
  ]);

  return download(out, "tickets");
}
