import ExcelJS from "exceljs";
import { createAdminClient } from "@/lib/supabase/admin";
import { bandHex } from "@/lib/bands";

/**
 * Tickets workbook for the organizer: a Summary sheet, then one sheet per
 * wristband label (ticket type) in the organizer's own order. Each tab and its
 * header row take the wristband colour, so "green sheet = VIP Standing" at a
 * glance. Walk-in-only labels list their gate taps instead of tickets.
 */

type TypeRow = { id: string; code: string; name: string; band_color: string | null; price_centavos: number; walkin_price_centavos: number | null; sort_order: number; sell_online: boolean };
type TicketRow = {
  number: string; status: string; holder_name: string | null; shirt_size: string | null; vehicle_plate: string | null; vehicle_model: string | null;
  vehicle_photo_path: string | null; companion_of: string | null; redeemed_at: string | null; void_reason: string | null; ticket_type_id: string; created_at: string;
  order: { order_no: number; receipt_no: number | null; status: string; channel: string; buyer_name: string; buyer_email: string | null; buyer_mobile: string | null; total_centavos: number; payment_method: string | null; payment_reference: string | null; paid_at: string | null } | null;
};
type WalkinRow = { created_at: string; qty: number; unit_price_centavos: number; payment_method: string; ticket_type_id: string; staff: { full_name: string } | null };
type AvailRow = { ticket_type_id: string; pool_total: number; pool_available: number; voided: number; online_sold: number; walkin_sold: number; reserved: number; sellable: number; online_revenue_centavos: number; walkin_revenue_centavos: number; redeemed: number };

const manila = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila" }) : "");
const php = (c: number | null | undefined) => (typeof c === "number" ? c / 100 : null);

/** Sheet names may not contain []:*?/\ and are capped at 31 chars. */
function sheetName(t: TypeRow): string {
  return `${t.code} ${t.name}`.replace(/[\[\]:*?/\\]/g, " ").slice(0, 31);
}

/** Black text on light bands (yellow), white on the rest. */
function fontFor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 160 ? "FF111111" : "FFFFFFFF";
}

function styleHeader(ws: ExcelJS.Worksheet, rowNo: number, hex: string, cols: number) {
  const argb = "FF" + hex.slice(1).toUpperCase();
  const row = ws.getRow(rowNo);
  row.font = { bold: true, color: { argb: fontFor(hex) } };
  for (let c = 1; c <= cols; c++) {
    row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
    row.getCell(c).border = { bottom: { style: "thin", color: { argb: "FF444444" } } };
  }
  row.alignment = { vertical: "middle" };
}

function bandBlock(ws: ExcelJS.Worksheet, t: TypeRow, hex: string) {
  const argb = "FF" + hex.slice(1).toUpperCase();
  ws.mergeCells("A1:D1");
  const title = ws.getCell("A1");
  title.value = `${t.name}  (${t.code})  -  ${t.band_color ?? "no colour"} wristband`;
  title.font = { bold: true, size: 14, color: { argb: fontFor(hex) } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
  title.alignment = { vertical: "middle" };
  ws.getRow(1).height = 26;
  if (t.band_color && /stripe/i.test(t.band_color)) {
    // Striped bands: alternate the two title cells so the tab still reads as "stripes"
    ws.getCell("E1").value = "stripes";
    ws.getCell("E1").fill = { type: "pattern", pattern: "lightUp", fgColor: { argb }, bgColor: { argb: "FFF4F4F5" } };
    ws.getCell("E1").font = { color: { argb: "FF111111" }, italic: true };
  }
}

export async function buildTicketsWorkbook(): Promise<Buffer> {
  const admin = createAdminClient();
  const [{ data: types }, { data: tickets }, { data: walkins }, { data: avail }, { data: event }] = await Promise.all([
    admin.from("ticket_types").select("id, code, name, band_color, price_centavos, walkin_price_centavos, sort_order, sell_online").eq("active", true).order("sort_order"),
    admin
      .from("tickets")
      .select(
        "number, status, holder_name, shirt_size, vehicle_plate, vehicle_model, vehicle_photo_path, companion_of, redeemed_at, void_reason, ticket_type_id, created_at, order:orders(order_no, receipt_no, status, channel, buyer_name, buyer_email, buyer_mobile, total_centavos, payment_method, payment_reference, paid_at)",
      )
      .order("number")
      .limit(50000),
    admin.from("walkin_sales").select("created_at, qty, unit_price_centavos, payment_method, ticket_type_id, staff:staff(full_name)").order("created_at").limit(50000),
    admin.from("v_ticket_type_availability").select("ticket_type_id, pool_total, pool_available, voided, online_sold, walkin_sold, reserved, sellable, online_revenue_centavos, walkin_revenue_centavos, redeemed"),
    admin.from("events").select("name").limit(1).maybeSingle(),
  ]);

  const T = (types ?? []) as TypeRow[];
  const allTickets = (tickets ?? []) as unknown as TicketRow[];
  const allWalkins = (walkins ?? []) as unknown as WalkinRow[];
  const availBy = new Map(((avail ?? []) as AvailRow[]).map((a) => [a.ticket_type_id, a]));

  const wb = new ExcelJS.Workbook();
  wb.creator = event?.name ?? "Ticketing";
  wb.created = new Date();

  // ------------------------------------------------------------ Summary
  const sum = wb.addWorksheet("Summary", { properties: { tabColor: { argb: "FF111111" } }, views: [{ state: "frozen", ySplit: 3 }] });
  sum.mergeCells("A1:L1");
  sum.getCell("A1").value = `${event?.name ?? "Event"} - ticket export - ${new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" })} (Manila)`;
  sum.getCell("A1").font = { bold: true, size: 13 };
  sum.getCell("A2").value = "One sheet per wristband label follows; the tab colour is the wristband colour. Amounts in PHP.";
  sum.getCell("A2").font = { italic: true, color: { argb: "FF666666" } };
  const sumHeader = ["Code", "Ticket type", "Wristband", "Price", "Pool total", "Online tickets", "Walk-in bands", "Reserved (unpaid)", "Voided", "Left to sell", "Scanned at gate", "Revenue (PHP)"];
  sum.addRow(sumHeader);
  styleHeader(sum, 3, "#111111", sumHeader.length);
  for (const t of T) {
    const a = availBy.get(t.id);
    const hex = bandHex(t.band_color);
    const r = sum.addRow([
      t.code, t.name, t.band_color ?? "", php(t.price_centavos), Number(a?.pool_total ?? 0), Number(a?.online_sold ?? 0), Number(a?.walkin_sold ?? 0), Number(a?.reserved ?? 0),
      Number(a?.voided ?? 0), Number(a?.sellable ?? 0), Number(a?.redeemed ?? 0), php(Number(a?.online_revenue_centavos ?? 0) + Number(a?.walkin_revenue_centavos ?? 0)),
    ]);
    const argb = "FF" + hex.slice(1).toUpperCase();
    r.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
    r.getCell(1).font = { bold: true, color: { argb: fontFor(hex) } };
    r.getCell(1).alignment = { horizontal: "center" };
    r.getCell(3).fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
    r.getCell(3).font = { color: { argb: fontFor(hex) } };
    r.getCell(4).numFmt = "#,##0.00";
    r.getCell(12).numFmt = "#,##0.00";
  }
  const totals = sum.addRow(["", "Total", "", "", ...[5, 6, 7, 8, 9, 10, 11, 12].map((c) => ({ formula: `SUM(${sum.getColumn(c).letter}4:${sum.getColumn(c).letter}${3 + T.length})` }))]);
  totals.font = { bold: true };
  totals.getCell(12).numFmt = "#,##0.00";
  sum.columns.forEach((c, i) => { c.width = [7, 26, 20, 10, 11, 14, 14, 16, 9, 12, 15, 15][i] ?? 12; });

  // ------------------------------------------------------ per label sheets
  const ticketHeader = ["Wristband no.", "Status", "Holder", "Shirt", "Plate", "Vehicle", "Car photo", "Companion of car", "Scanned at gate", "Void reason", "Order #", "Receipt #", "Order status", "Channel", "Buyer", "Email", "Mobile", "Order total (PHP)", "Payment", "Reference", "Paid at", "Issued at"];
  const walkinHeader = ["Time (Manila)", "Bands", "Price each (PHP)", "Amount (PHP)", "Payment", "Staff"];

  for (const t of T) {
    const hex = bandHex(t.band_color);
    const argb = "FF" + hex.slice(1).toUpperCase();
    const ws = wb.addWorksheet(sheetName(t), { properties: { tabColor: { argb } } });
    bandBlock(ws, t, hex);

    const mine = allTickets.filter((x) => x.ticket_type_id === t.id);
    const taps = allWalkins.filter((w) => w.ticket_type_id === t.id);
    const a = availBy.get(t.id);
    const voidCount = mine.filter((x) => x.status === "void").length;
    ws.getCell("A2").value = `${mine.length - voidCount} valid online ticket(s)${voidCount ? ` (+${voidCount} void)` : ""}  |  ${Number(a?.walkin_sold ?? 0)} walk-in band(s)  |  ${Number(a?.sellable ?? 0)} left to sell  |  ${Number(a?.redeemed ?? 0)} scanned at gate`;
    ws.getCell("A2").font = { italic: true, color: { argb: "FF555555" } };

    let row = 4;
    if (mine.length > 0 || t.sell_online) {
      ws.getCell(`A${row - 1}`).value = "Online tickets (one row per wristband)";
      ws.getCell(`A${row - 1}`).font = { bold: true };
      ws.getRow(row).values = ticketHeader;
      styleHeader(ws, row, hex, ticketHeader.length);
      const start = row + 1;
      for (const x of mine) {
        row += 1;
        const r = ws.getRow(row);
        r.values = [
          x.number, x.status, x.holder_name ?? "", x.shirt_size ?? "", x.vehicle_plate ?? "", x.vehicle_model ?? "", x.vehicle_photo_path ? "yes" : "", x.companion_of ?? "",
          manila(x.redeemed_at), x.void_reason ?? "", x.order?.order_no ?? "", x.order?.receipt_no ?? "", x.order?.status ?? "", x.order?.channel ?? "", x.order?.buyer_name ?? "",
          x.order?.buyer_email ?? "", x.order?.buyer_mobile ?? "", php(x.order?.total_centavos), x.order?.payment_method ?? "", x.order?.payment_reference ?? "", manila(x.order?.paid_at), manila(x.created_at),
        ];
        r.getCell(1).font = { bold: true };
        r.getCell(18).numFmt = "#,##0.00";
        if (x.status === "void") { r.font = { color: { argb: "FF999999" }, strike: true }; r.getCell(2).font = { bold: true, color: { argb: "FFCC0000" }, strike: false }; }
        if (x.status === "redeemed") r.getCell(2).font = { bold: true, color: { argb: "FF1B7F3B" } };
      }
      ws.autoFilter = { from: { row: start - 1, column: 1 }, to: { row: Math.max(start - 1, row), column: ticketHeader.length } };
      ws.views = [{ state: "frozen", ySplit: start - 1 }];
      row += 3;
    }

    if (taps.length > 0 || !t.sell_online) {
      ws.getCell(`A${row - 1}`).value = "Walk-in tally at the gate (no names are collected)";
      ws.getCell(`A${row - 1}`).font = { bold: true };
      ws.getRow(row).values = walkinHeader;
      styleHeader(ws, row, hex, walkinHeader.length);
      for (const w of taps) {
        row += 1;
        const r = ws.getRow(row);
        r.values = [manila(w.created_at), w.qty, php(w.unit_price_centavos), php(w.qty * w.unit_price_centavos), w.payment_method, w.staff?.full_name ?? ""];
        r.getCell(3).numFmt = "#,##0.00";
        r.getCell(4).numFmt = "#,##0.00";
      }
      if (taps.length === 0) { row += 1; ws.getCell(`A${row}`).value = "No walk-in bands recorded yet."; ws.getCell(`A${row}`).font = { italic: true, color: { argb: "FF888888" } }; }
    }

    const widths = [14, 10, 22, 6, 11, 22, 9, 16, 19, 28, 8, 9, 13, 8, 22, 28, 13, 16, 9, 20, 19, 19];
    ws.columns.forEach((c, i) => { c.width = widths[i] ?? 12; });
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}
