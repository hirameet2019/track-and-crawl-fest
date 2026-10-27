import { LOCALE } from "@/config/site";
import { fetchAll } from "@/lib/fetch-all";
import { shirtShips, shippingOneLine, type Shipping } from "@/lib/shipping";
import ExcelJS from "exceljs";
import { createAdminClient } from "@/lib/supabase/admin";
import { bandHex } from "@/lib/bands";
import { getRules } from "@/lib/rules";

/**
 * Tickets workbook for the organizer: a Summary sheet, a Shirts sheet (every shirt
 * by size, then holder), then one sheet per wristband label (ticket type) in the
 * organizer's own order. Each tab and its
 * header row take the wristband colour, so "green sheet = VIP Pass" at a
 * glance. Walk-in-only labels list their gate taps instead of tickets.
 *
 * Every table sits apart from the titles and labels above it (and from a totals
 * row below) by an empty row: Excel's Sort and Filter take the block of filled
 * cells around the selection, so a title touching the header row would be read as
 * the header and sorted along with the data.
 */

type TypeRow = { id: string; code: string; name: string; band_color: string | null; price_centavos: number; walkin_price_centavos: number | null; sort_order: number; sell_online: boolean; drifter_family: boolean; ships_shirt: boolean; includes_shirt: boolean };
type TicketRow = {
  number: string; status: string; holder_name: string | null; shirt_size: string | null; vehicle_plate: string | null; vehicle_model: string | null;
  vehicle_photo_path: string | null; companion_of: string | null; included: boolean; redeemed_at: string | null; void_reason: string | null; ticket_type_id: string; created_at: string;
  /** What the gate handed over, ticked on the scanner: {"shirt": true, ...}. */
  kit_claimed: Record<string, boolean> | null;
  order: { order_no: number; receipt_no: number | null; status: string; channel: string; buyer_name: string; buyer_email: string | null; buyer_mobile: string | null; total_centavos: number; payment_method: string | null; payment_channel_label?: string | null; payment_reference: string | null; paid_at: string | null; shipping: Shipping | null; order_items: { ticket_type_id: string; qty: number; unit_price_centavos: number }[] } | null;
};
type WalkinRow = { created_at: string; qty: number; free_qty: number; drifter_name: string | null; unit_price_centavos: number; payment_method: string; payment_ref: string | null; shirt_size: string | null; holder_name: string | null; vehicle_plate: string | null; ticket_type_id: string; staff: { full_name: string } | null;
  /** Where the shirt of a gate VIP Pass ships (since 10 October); null: handed over or no shirt. */
  shipping: Shipping | null };
/** Free units in a gate sale (a car's included passengers) are handed over, not sold. */
const tapAmount = (w: WalkinRow) => (w.qty - w.free_qty) * w.unit_price_centavos;
type AvailRow = { ticket_type_id: string; pool_type_id: string | null; pool_total: number; pool_available: number; voided: number; online_sold: number; walkin_sold: number; reserved: number; sellable: number; online_revenue_centavos: number; walkin_revenue_centavos: number; redeemed: number };

const manila = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(LOCALE.locale, { timeZone: LOCALE.timeZone }) : "");
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
  title.value = t.band_color ? `${t.name}  (${t.code})  -  ${t.band_color} band` : `${t.name}  (${t.code})`;
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
  const { terms } = await getRules();
  const [{ data: types }, tickets, walkins, { data: avail }, { data: event }] = await Promise.all([
    admin.from("ticket_types").select("id, code, name, band_color, price_centavos, walkin_price_centavos, sort_order, sell_online, drifter_family, ships_shirt, includes_shirt").eq("active", true).order("sort_order"),
    fetchAll((from, to) =>
      admin
        .from("tickets")
        .select(
          "number, status, holder_name, shirt_size, vehicle_plate, vehicle_model, vehicle_photo_path, companion_of, included, redeemed_at, void_reason, ticket_type_id, created_at, kit_claimed, order:orders(order_no, receipt_no, status, channel, buyer_name, buyer_email, buyer_mobile, total_centavos, payment_method, payment_channel_label, payment_reference, paid_at, shipping, order_items(ticket_type_id, qty, unit_price_centavos))",
        )
        .order("number")
        .order("id")
        .range(from, to),
    ),
    fetchAll((from, to) => admin.from("walkin_sales").select("created_at, qty, free_qty, drifter_name, unit_price_centavos, payment_method, payment_ref, shirt_size, holder_name, vehicle_plate, ticket_type_id, staff:staff(full_name), shipping").order("created_at").order("id").range(from, to)),
    admin.from("v_ticket_type_availability").select("ticket_type_id, pool_type_id, pool_total, pool_available, voided, online_sold, walkin_sold, reserved, sellable, online_revenue_centavos, walkin_revenue_centavos, redeemed"),
    admin.from("events").select("name").limit(1).maybeSingle(),
  ]);

  const T = (types ?? []) as TypeRow[];
  const orderTotal = (o: NonNullable<TicketRow["order"]>) => o.total_centavos;
  const allTickets = (tickets ?? []) as unknown as TicketRow[];
  const allWalkins = (walkins ?? []) as unknown as WalkinRow[];
  const availBy = new Map(((avail ?? []) as AvailRow[]).map((a) => [a.ticket_type_id, a]));

  const wb = new ExcelJS.Workbook();
  wb.creator = event?.name ?? "Ticketing";
  wb.created = new Date();

  // ------------------------------------------------------------ Summary
  const sum = wb.addWorksheet("Summary", { properties: { tabColor: { argb: "FF111111" } }, views: [{ state: "frozen", ySplit: 4 }] });
  sum.mergeCells("A1:L1");
  sum.getCell("A1").value = `${event?.name ?? "Event"} - ticket export - ${new Date().toLocaleString(LOCALE.locale, { timeZone: LOCALE.timeZone })} (Manila)`;
  sum.getCell("A1").font = { bold: true, size: 13 };
  sum.getCell("A2").value = "One sheet per ticket type follows; the tab colour is its band colour, if it has one. Amounts in PHP.";
  sum.getCell("A2").font = { italic: true, color: { argb: "FF666666" } };
  const sumHeader = ["Code", "Ticket type", "Band colour", "Price", "Pool total", "Online tickets", "Gate / family bands", "Reserved (unpaid)", "Voided", "Left to sell", "Scanned at gate", "Revenue (PHP)"];
  sum.getRow(4).values = sumHeader;
  styleHeader(sum, 4, "#111111", sumHeader.length);
  for (const [i, t] of T.entries()) {
    const a = availBy.get(t.id);
    const hex = bandHex(t.band_color);
    // A label on another label's stack: its pool and "left" are that stack's, so they
    // go in as text and stay out of the totals.
    const lender = a?.pool_type_id ? T.find((x) => x.id === a.pool_type_id)?.code ?? "another label" : null;
    const r = sum.getRow(5 + i);
    r.values = [
      t.code, t.name, t.band_color ?? "", php(t.price_centavos), lender ? `uses ${lender} bands` : Number(a?.pool_total ?? 0), Number(a?.online_sold ?? 0), Number(a?.walkin_sold ?? 0), Number(a?.reserved ?? 0),
      Number(a?.voided ?? 0), lender ? `${Number(a?.sellable ?? 0)} (shared with ${lender})` : Number(a?.sellable ?? 0), Number(a?.redeemed ?? 0), php(Number(a?.online_revenue_centavos ?? 0) + Number(a?.walkin_revenue_centavos ?? 0)),
    ];
    const argb = "FF" + hex.slice(1).toUpperCase();
    r.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
    r.getCell(1).font = { bold: true, color: { argb: fontFor(hex) } };
    r.getCell(1).alignment = { horizontal: "center" };
    r.getCell(3).fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
    r.getCell(3).font = { color: { argb: fontFor(hex) } };
    r.getCell(4).numFmt = "#,##0.00";
    r.getCell(12).numFmt = "#,##0.00";
  }
  const totals = sum.getRow(5 + T.length + 1);
  totals.values = ["", "Total", "", "", ...[5, 6, 7, 8, 9, 10, 11, 12].map((c) => ({ formula: `SUM(${sum.getColumn(c).letter}5:${sum.getColumn(c).letter}${4 + T.length})` }))];
  totals.font = { bold: true };
  totals.getCell(12).numFmt = "#,##0.00";
  sum.columns.forEach((c, i) => { c.width = [7, 26, 20, 10, 11, 14, 14, 16, 9, 12, 15, 15][i] ?? 12; });

  // ------------------------------------------------------------- Shirts
  // Every shirt still to hand over or ship, by size (the order of the size chart in
  // Settings) and then holder A to Z, so the hand-out table and the courier pile can
  // be counted off in order. Online: each live ticket with a shirt (free passengers
  // get none). Gate: sales netted per label, name and size, so a take-back cancels
  // its sale; a VIP Pass sold at the gate ships its shirt when the sale carries an
  // address, and the other gate shirts were handed over at the desk (counts only).
  const sizeOrder = (await getRules()).shirtChart.map((c) => c.size.toUpperCase());
  const sizeKey = (v: string | null) => (v ?? "").trim().toUpperCase();
  const sizeRank = (k: string) => (k === "" ? 10_000 : sizeOrder.includes(k) ? sizeOrder.indexOf(k) : 5_000);
  const bySize = (a: string, b: string) => sizeRank(a) - sizeRank(b) || a.localeCompare(b);
  const typeOf = new Map(T.map((t) => [t.id, t]));

  type ShirtItem = {
    size: string; holder: string; number: string; ticket: string; sold: "Online" | "Gate"; ship: Shipping | null;
    handed: boolean; scanned: string; orderNo: number | string; buyer: string; mobile: string;
  };
  const items: ShirtItem[] = allTickets
    .filter((x) => !x.included && x.status !== "void" && typeOf.get(x.ticket_type_id)?.includes_shirt)
    .map((x) => {
      const t = typeOf.get(x.ticket_type_id);
      const ship = shirtShips(t, x.order) ? x.order!.shipping : null;
      return {
        size: sizeKey(x.shirt_size), holder: x.holder_name ?? "", number: x.number, ticket: t?.name ?? "", sold: "Online" as const, ship,
        handed: !!x.kit_claimed?.shirt, scanned: manila(x.redeemed_at), orderNo: x.order?.order_no ?? "", buyer: x.order?.buyer_name ?? "", mobile: x.order?.buyer_mobile ?? "",
      };
    });

  const gateGroups = new Map<string, { t: TypeRow; holder: string; size: string; net: number; ship: Shipping | null }>();
  for (const w of allWalkins) {
    const t = typeOf.get(w.ticket_type_id);
    if (!t?.includes_shirt) continue;
    const key = `${t.id}|${(w.holder_name ?? "").trim().toLowerCase()}|${sizeKey(w.shirt_size)}`;
    const g = gateGroups.get(key) ?? { t, holder: w.holder_name ?? "", size: sizeKey(w.shirt_size), net: 0, ship: null };
    // One shirt per sale: the free passenger of a car package has none.
    g.net += w.qty - w.free_qty;
    if (w.qty > 0 && w.shipping) g.ship = w.shipping;
    gateGroups.set(key, g);
  }
  let gateHanded = 0;
  const gateHandedBySize = new Map<string, number>();
  for (const g of gateGroups.values()) {
    if (g.net <= 0) continue;
    if (!g.ship) { gateHanded += g.net; gateHandedBySize.set(g.size, (gateHandedBySize.get(g.size) ?? 0) + g.net); continue; }
    for (let i = 0; i < g.net; i++) {
      items.push({ size: g.size, holder: g.holder, number: "", ticket: g.t.name, sold: "Gate", ship: g.ship, handed: false, scanned: "", orderNo: "", buyer: "", mobile: g.ship.mobile });
    }
  }
  items.sort((a, b) => bySize(a.size, b.size) || a.holder.localeCompare(b.holder, "en", { sensitivity: "base" }) || a.number.localeCompare(b.number));

  const counts = new Map<string, { event: number; ship: number; gateShip: number; gateHanded: number }>();
  const countOf = (k: string) => counts.get(k) ?? counts.set(k, { event: 0, ship: 0, gateShip: 0, gateHanded: 0 }).get(k)!;
  for (const x of items) countOf(x.size)[x.sold === "Gate" ? "gateShip" : x.ship ? "ship" : "event"] += 1;
  for (const [k, n] of gateHandedBySize) countOf(k).gateHanded += n;
  const sizesUsed = [...counts.entries()].filter(([, c]) => c.event || c.ship || c.gateShip || c.gateHanded).map(([k]) => k).sort(bySize);

  // Only when a label left in this file has a shirt (none does once the VIP labels are out).
  if (items.length > 0 || gateHanded > 0) {
    const shirtHex = "#0E7490";
    const sh = wb.addWorksheet("Shirts", { properties: { tabColor: { argb: "FF0E7490" } } });
    sh.mergeCells("A1:F1");
    sh.getCell("A1").value = `${event?.name ?? "Event"} - shirts by size`;
    sh.getCell("A1").font = { bold: true, size: 13 };
    sh.getCell("A2").value = "Every shirt to hand over or ship, by size and then holder A to Z. Free passengers have no shirt and void tickets are left out. \"Ships\" shirts go by courier to the address shown, not over the counter. Gate shirts already handed over at the desk are only counted.";
    sh.getCell("A2").font = { italic: true, color: { argb: "FF666666" } };

    const countHeader = ["Size", "Online: at the event", "Online: ships", "Gate: ships", "Gate: handed over", "Total"];
    sh.getRow(4).values = countHeader;
    styleHeader(sh, 4, shirtHex, countHeader.length);
    let srow = 4;
    for (const k of sizesUsed) {
      srow += 1;
      const c = counts.get(k)!;
      sh.getRow(srow).values = [k || "(no size)", c.event, c.ship, c.gateShip, c.gateHanded, { formula: `SUM(B${srow}:E${srow})` }];
      sh.getCell(`A${srow}`).font = { bold: true };
    }
    srow += 1;
    sh.getRow(srow).values = ["Total", ...["B", "C", "D", "E", "F"].map((col) => ({ formula: sizesUsed.length ? `SUM(${col}5:${col}${srow - 1})` : "0" }))];
    sh.getRow(srow).font = { bold: true };
    for (let c = 1; c <= countHeader.length; c++) sh.getRow(srow).getCell(c).border = { top: { style: "thin", color: { argb: "FF444444" } } };

    // The list: its label two rows up, then an empty row, then the header.
    srow += 3;
    sh.getCell(`A${srow}`).value = `One row per shirt to hand over or ship (${items.length})${gateHanded ? `; ${gateHanded} gate shirt(s) already handed over are not listed` : ""}`;
    sh.getCell(`A${srow}`).font = { bold: true };
    srow += 2;
    const shirtHeader = ["Size", "Holder", terms.numberLabel, "Ticket", "Sold", "Hand-out", "Ship to", "Shirt handed", "Scanned at gate", "Order #", "Buyer", "Mobile"];
    sh.getRow(srow).values = shirtHeader;
    styleHeader(sh, srow, shirtHex, shirtHeader.length);
    const listHeaderRow = srow;
    let lastSize: string | null = null;
    for (const x of items) {
      srow += 1;
      const r = sh.getRow(srow);
      r.values = [
        x.size || "(no size)", x.holder, x.number, x.ticket, x.sold,
        x.ship ? `Ships (${x.ship.courier})` : "At the event", x.ship ? shippingOneLine(x.ship) : "",
        x.handed ? "yes" : "", x.scanned, x.orderNo, x.buyer, x.mobile,
      ];
      r.getCell(1).font = { bold: true };
      // A thin rule where a new size starts, so the piles are easy to count off.
      if (lastSize !== null && x.size !== lastSize) for (let c = 1; c <= shirtHeader.length; c++) r.getCell(c).border = { top: { style: "thin", color: { argb: "FF888888" } } };
      lastSize = x.size;
    }
    if (items.length === 0) { srow += 1; sh.getCell(`A${srow}`).value = "No shirts to hand over or ship yet."; sh.getCell(`A${srow}`).font = { italic: true, color: { argb: "FF888888" } }; }
    sh.autoFilter = { from: { row: listHeaderRow, column: 1 }, to: { row: Math.max(listHeaderRow, srow), column: shirtHeader.length } };
    sh.columns.forEach((c, i) => { c.width = [11, 30, 14, 26, 8, 16, 48, 12, 19, 9, 28, 14][i] ?? 12; });
  }

  // ------------------------------------------------------ per label sheets
  const ticketHeader = [terms.numberLabel, "Status", "Holder", "Shirt", "Plate", "Vehicle", "Vehicle photo", "Companion of car", "Ship shirt to", "Scanned at gate", "Void reason", "Order #", "Receipt #", "Order status", "Channel", "Buyer", "Email", "Mobile", "Order total (PHP)", "Payment", "Reference", "Paid at", "Issued at"];
  // A package sale (VIP Car with shirt) is one sale of two bands: the passenger's is included.
  const walkinHeader = ["Time (Manila)", "Sales", "Bands", "Price each (PHP)", "Amount (PHP)", "Shirt", "Name", "Plate", "Payment", "Reference", "Staff"];

  for (const t of T) {
    const hex = bandHex(t.band_color);
    const argb = "FF" + hex.slice(1).toUpperCase();
    const ws = wb.addWorksheet(sheetName(t), { properties: { tabColor: { argb } } });
    bandBlock(ws, t, hex);

    const mine = allTickets.filter((x) => x.ticket_type_id === t.id);
    const taps = allWalkins.filter((w) => w.ticket_type_id === t.id);
    const a = availBy.get(t.id);
    const voidCount = mine.filter((x) => x.status === "void").length;
    ws.getCell("A2").value = `${mine.length - voidCount} valid online ${terms.many}${voidCount ? ` (+${voidCount} void)` : ""}  |  ${Number(a?.walkin_sold ?? 0)} walk-in  |  ${Number(a?.sellable ?? 0)} left to sell  |  ${Number(a?.redeemed ?? 0)} scanned at gate`;
    ws.getCell("A2").font = { italic: true, color: { argb: "FF555555" } };

    // Section label two rows above its header, an empty row between (see the top of the file).
    let row = 5;
    if (mine.length > 0 || t.sell_online) {
      ws.getCell(`A${row - 2}`).value = `Online tickets (one row per ${terms.one})`;
      ws.getCell(`A${row - 2}`).font = { bold: true };
      ws.getRow(row).values = ticketHeader;
      styleHeader(ws, row, hex, ticketHeader.length);
      const start = row + 1;
      for (const x of mine) {
        row += 1;
        const r = ws.getRow(row);
        r.values = [
          x.number, x.status, x.holder_name ?? "", x.shirt_size ?? "", x.vehicle_plate ?? "", x.vehicle_model ?? "", x.vehicle_photo_path ? "yes" : "", x.companion_of ?? "",
          !x.included && shirtShips(t, x.order) ? shippingOneLine(x.order!.shipping!) : "", manila(x.redeemed_at), x.void_reason ?? "", x.order?.order_no ?? "", x.order?.receipt_no ?? "", x.order?.status ?? "", x.order?.channel ?? "", x.order?.buyer_name ?? "",
          x.order?.buyer_email ?? "", x.order?.buyer_mobile ?? "", php(x.order ? orderTotal(x.order) : null), x.order ? (x.order.payment_channel_label ?? x.order.payment_method ?? "") : "", x.order?.payment_reference ?? "", manila(x.order?.paid_at), manila(x.created_at),
        ];
        r.getCell(1).font = { bold: true };
        r.getCell(19).numFmt = "#,##0.00";
        if (x.status === "void") { r.font = { color: { argb: "FF999999" }, strike: true }; r.getCell(2).font = { bold: true, color: { argb: "FFCC0000" }, strike: false }; }
        if (x.status === "redeemed") r.getCell(2).font = { bold: true, color: { argb: "FF1B7F3B" } };
      }
      ws.autoFilter = { from: { row: start - 1, column: 1 }, to: { row: Math.max(start - 1, row), column: ticketHeader.length } };
      ws.views = [{ state: "frozen", ySplit: start - 1 }];
      row += 4;
    }

    if (taps.length > 0 || !t.sell_online) {
      ws.getCell(`A${row - 2}`).value = "Walk-in tally at the gate (no names are collected)";
      ws.getCell(`A${row - 2}`).font = { bold: true };
      ws.getRow(row).values = walkinHeader;
      styleHeader(ws, row, hex, walkinHeader.length);
      for (const w of taps) {
        row += 1;
        const r = ws.getRow(row);
        r.values = [manila(w.created_at), w.qty - w.free_qty, w.qty, php(w.unit_price_centavos), php(tapAmount(w)), w.shirt_size ?? "", w.holder_name ?? "", w.vehicle_plate ?? "", w.payment_method, w.payment_ref ?? "", w.staff?.full_name ?? ""];
        r.getCell(4).numFmt = "#,##0.00";
        r.getCell(5).numFmt = "#,##0.00";
      }
      if (taps.length === 0) { row += 1; ws.getCell(`A${row}`).value = "No walk-in sales recorded yet."; ws.getCell(`A${row}`).font = { italic: true, color: { argb: "FF888888" } }; }
    }

    // A gate-only label has just the walk-in table, so it gets that table's widths.
    const widths = !t.sell_online && mine.length === 0
        ? [22, 8, 8, 16, 14, 8, 24, 12, 10, 18, 20]
        : [14, 10, 22, 6, 11, 22, 9, 16, 40, 19, 28, 8, 9, 13, 8, 22, 28, 13, 16, 9, 20, 19, 19];
    ws.columns.forEach((c, i) => { c.width = widths[i] ?? 12; });
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}
