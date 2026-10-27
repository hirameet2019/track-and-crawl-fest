import ExcelJS from "exceljs";
import { LOCALE } from "@/config/site";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/fetch-all";
import { getActiveEvent } from "@/lib/queries";
import type { Shipping } from "@/lib/shipping";

/**
 * Walk-in sales by staff account, for the organizer's cash count: a Summary (per account
 * and wristband, SUMIFS over the account sheets), every entry in one list, then one
 * sheet per account. Built live from walkin_sales. Labels hidden in Settings
 * (hidden_in_admin: the VIP labels and drifter family bands) are left out, so it holds
 * the walk-ins only and matches the Dashboard and the Walk-in tab.
 *
 * Amount = (bands - free) x price: take-backs are negative bands, drifter family bands
 * inside the free allowance cost nothing. Every formula also carries its computed
 * result, so the numbers show even in viewers that do not recalculate.
 */

/** Accounts listed under another name in organizer-facing exports (the IT account). */
const ACCOUNT_LABELS: Record<string, string> = { frmgdelacruz: "Admin account" };

type Entry = {
  created_at: string; qty: number; free_qty: number; unit_price_centavos: number; payment_method: string; payment_ref: string | null;
  drifter_name: string | null; holder_name: string | null; vehicle_plate: string | null; shirt_size: string | null; shipping: Shipping | null;
  sold_by: string | null; ticket_type_id: string;
};
type Line = {
  account: string; at: Date; local: Date; wristband: string; entry: string; bands: number; free: number; price: number;
  name: string; plate: string; shirt: string; shipTo: string; payment: string; reference: string; otherDay: boolean;
};

const FONT = "Arial";
const HEAD = "FF1F2937";
const TOTAL = "FFE5E7EB";
const BACK = "FFFDECEC";
const OTHER_DAY = "FFFEF9C3";
const GRAND = "FFD1FAE5";
const PESO = '"₱"#,##0;-"₱"#,##0;"-"';
const INT = '#,##0;-#,##0;"-"';
const WHEN = "mmm d, yyyy h:mm:ss AM/PM";
const MANILA_OFFSET_MS = 8 * 3600 * 1000;

const manilaDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: LOCALE.timeZone });
/** Excel has no time zones: write Manila wall time as the cell's date. */
const wallTime = (iso: string) => new Date(Date.parse(iso) + MANILA_OFFSET_MS);
const shipLine = (s: Shipping | null) => (s ? `${s.name}, ${s.mobile} · ${s.address}, ${s.city}, ${s.province} ${s.zip} · ${s.courier}` : "");
const sheetTitle = (name: string) => name.replace(/[[\]:*?/\\]/g, " ").slice(0, 31);
const ref = (sheet: string) => `'${sheet.replace(/'/g, "''")}'`;

function head(ws: ExcelJS.Worksheet, rowNo: number, values: string[]) {
  const row = ws.getRow(rowNo);
  row.values = values;
  for (let c = 1; c <= values.length; c++) {
    const cell = row.getCell(c);
    cell.font = { name: FONT, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD } };
    cell.alignment = { vertical: "middle", wrapText: true };
  }
}
function paint(row: ExcelJS.Row, cols: number, argb: string, bold = false, top = false) {
  for (let c = 1; c <= cols; c++) {
    const cell = row.getCell(c);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
    if (bold) cell.font = { name: FONT, bold: true };
    if (top) cell.border = { top: { style: "thin", color: { argb: "FF9CA3AF" } } };
  }
}
function note(ws: ExcelJS.Worksheet, addr: string, text: string, title = false) {
  ws.getCell(addr).value = text;
  ws.getCell(addr).font = title ? { name: FONT, bold: true, size: 13 } : { name: FONT, italic: true, color: { argb: "FF555555" } };
}

export async function buildStaffSalesWorkbook(): Promise<Buffer> {
  const admin = createAdminClient();
  const event = await getActiveEvent();
  const [entries, { data: types }, { data: staff }] = await Promise.all([
    fetchAll<Entry>((from, to) =>
      admin
        .from("walkin_sales")
        .select("created_at, qty, free_qty, unit_price_centavos, payment_method, payment_ref, drifter_name, holder_name, vehicle_plate, shirt_size, shipping, sold_by, ticket_type_id")
        .order("created_at")
        .order("id")
        .range(from, to),
    ),
    admin.from("ticket_types").select("id, name, walkin_name, band_color, sort_order, hidden_in_admin"),
    admin.from("staff").select("id, full_name"),
  ]);

  const typeOf = new Map((types ?? []).map((t) => [t.id as string, t as { name: string; walkin_name: string | null; band_color: string | null; sort_order: number; hidden_in_admin: boolean }]));
  const staffName = new Map((staff ?? []).map((s) => [s.id as string, s.full_name as string]));
  const eventDay = event?.starts_at ? manilaDay(new Date(event.starts_at)) : null;
  const [ey, em, ed] = (eventDay ?? "1970-01-01").split("-").map(Number);
  const dayLabel = eventDay ? new Date(Date.UTC(ey, em - 1, ed)).toLocaleDateString("en-PH", { day: "numeric", month: "short", timeZone: "UTC" }) : "event day";

  const lines: Line[] = entries.filter((e) => !typeOf.get(e.ticket_type_id)?.hidden_in_admin).map((e) => {
    const t = typeOf.get(e.ticket_type_id);
    const raw = (e.sold_by && staffName.get(e.sold_by)) || "(no account)";
    const at = new Date(e.created_at);
    return {
      account: ACCOUNT_LABELS[raw] ?? raw,
      at,
      local: wallTime(e.created_at),
      wristband: `${t?.walkin_name ?? t?.name ?? "?"}${t?.band_color ? ` (${t.band_color.toLowerCase()})` : ""}`,
      entry: e.qty < 0 ? "Take-back" : e.drifter_name ? "Family bands" : "Sale",
      bands: e.qty,
      free: e.free_qty,
      price: e.unit_price_centavos / 100,
      name: e.drifter_name ?? e.holder_name ?? "",
      plate: e.vehicle_plate ?? "",
      shirt: e.shirt_size ?? "",
      shipTo: shipLine(e.shipping),
      payment: e.payment_method,
      reference: e.payment_ref ?? "",
      otherDay: !!eventDay && manilaDay(at) !== eventDay,
    };
  });
  const amount = (l: Line) => (l.bands - l.free) * l.price;
  const rank = (w: string) => {
    const t = [...typeOf.values()].find((x) => w.startsWith(`${x.walkin_name ?? x.name} (`));
    return t?.sort_order ?? 999;
  };

  // Accounts in order of what they took in, the biggest desk first.
  const accounts = [...new Set(lines.map((l) => l.account))]
    .map((a) => ({ a, total: lines.filter((l) => l.account === a).reduce((s, l) => s + amount(l), 0) }))
    .sort((x, y) => y.total - x.total)
    .map((x) => x.a);
  const sheetOf = new Map<string, string>();
  for (const a of accounts) {
    let title = sheetTitle(a);
    for (let n = 2; ["Summary", "All entries", ...sheetOf.values()].includes(title); n++) title = sheetTitle(`${a} ${n}`);
    sheetOf.set(a, title);
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = event?.name ?? "Ticketing";
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;
  const summary = wb.addWorksheet("Summary", { views: [{ state: "frozen", ySplit: 4 }] });
  const all = wb.addWorksheet("All entries", { views: [{ state: "frozen", ySplit: 4 }] });

  const DETAIL = ["Time (Manila)", "Ticket type", "Entry", "Bands", "Free", "Price (PHP)", "Amount (PHP)", "Name", "Plate", "Shirt", "Shirt ships to", "Payment", "Reference"];
  const WIDTHS = [26, 34, 13, 8, 7, 12, 14, 30, 12, 7, 60, 10, 14];
  /** One entry per row from `first`, columns shifted right by `shift`; returns the last data row. */
  function writeEntries(ws: ExcelJS.Worksheet, list: Line[], first: number, shift: number) {
    list.forEach((l, i) => {
      const r = first + i;
      const c = (n: number) => n + shift;
      const L = (n: number) => String.fromCharCode(64 + c(n));
      const row = ws.getRow(r);
      if (shift) row.getCell(1).value = l.account;
      row.getCell(c(1)).value = l.local;
      row.getCell(c(2)).value = l.wristband;
      row.getCell(c(3)).value = l.entry;
      row.getCell(c(4)).value = l.bands;
      row.getCell(c(5)).value = l.free;
      row.getCell(c(6)).value = l.price;
      row.getCell(c(7)).value = { formula: `(${L(4)}${r}-${L(5)}${r})*${L(6)}${r}`, result: amount(l) };
      row.getCell(c(8)).value = l.name;
      row.getCell(c(9)).value = l.plate;
      row.getCell(c(10)).value = l.shirt;
      row.getCell(c(11)).value = l.shipTo;
      row.getCell(c(12)).value = l.payment;
      row.getCell(c(13)).value = l.reference;
      for (let n = 1; n <= DETAIL.length + shift; n++) {
        const cell = row.getCell(n);
        cell.font = { name: FONT, color: { argb: n === c(6) ? "FF0000FF" : l.bands < 0 ? "FFB91C1C" : "FF111111" } };
        if (l.bands < 0 || l.otherDay) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: l.bands < 0 ? BACK : OTHER_DAY } };
      }
      row.getCell(c(1)).numFmt = WHEN;
      row.getCell(c(4)).numFmt = INT;
      row.getCell(c(5)).numFmt = INT;
      row.getCell(c(6)).numFmt = PESO;
      row.getCell(c(7)).numFmt = PESO;
    });
    const last = first + list.length - 1;
    const tot = ws.getRow(last + 2);
    const L = (n: number) => String.fromCharCode(64 + n + shift);
    tot.getCell(1).value = "Total";
    tot.getCell(4 + shift).value = { formula: `SUM(${L(4)}${first}:${L(4)}${last})`, result: list.reduce((s, l) => s + l.bands, 0) };
    tot.getCell(5 + shift).value = { formula: `SUM(${L(5)}${first}:${L(5)}${last})`, result: list.reduce((s, l) => s + l.free, 0) };
    tot.getCell(7 + shift).value = { formula: `SUM(${L(7)}${first}:${L(7)}${last})`, result: list.reduce((s, l) => s + amount(l), 0) };
    paint(tot, DETAIL.length + shift, TOTAL, true, true);
    tot.getCell(4 + shift).numFmt = INT;
    tot.getCell(5 + shift).numFmt = INT;
    tot.getCell(7 + shift).numFmt = PESO;
    ws.autoFilter = { from: { row: first - 1, column: 1 }, to: { row: Math.max(first - 1, last), column: DETAIL.length + shift } };
    return last;
  }

  const legend =
    "Times are Manila time. Take-back = a sale undone after a wrong tap (negative). Free = units handed over at no charge (a car's included passengers). " +
    `Amount = (sold - free) x price. Yellow rows were recorded on another day than ${dayLabel}.`;

  // --------------------------------------------------------- All entries
  note(all, "A1", "Every walk-in entry by every staff account, by time", true);
  note(all, "A2", legend);
  // Row 3 stays empty so Excel's Sort and Filter see each table on its own.
  head(all, 4, ["Staff", ...DETAIL]);
  writeEntries(all, [...lines].sort((a, b) => a.at.getTime() - b.at.getTime()), 5, 1);
  all.columns.forEach((col, i) => { col.width = [14, ...WIDTHS][i] ?? 12; });

  // ------------------------------------------------------- account sheets
  const ranges = new Map<string, { sheet: string; first: number; last: number }>();
  for (const a of accounts) {
    const title = sheetOf.get(a)!;
    const ws = wb.addWorksheet(title, { views: [{ state: "frozen", ySplit: 4 }] });
    note(ws, "A1", `${a} - every entry`, true);
    note(ws, "A2", legend);
    head(ws, 4, DETAIL);
    const mine = lines.filter((l) => l.account === a);
    const last = writeEntries(ws, mine, 5, 0);
    ranges.set(a, { sheet: title, first: 5, last });
    ws.columns.forEach((col, i) => { col.width = WIDTHS[i] ?? 12; });
  }

  // ------------------------------------------------------------- Summary
  note(summary, "A1", `${event?.name ?? "Event"} - walk-in sales by staff account`, true);
  note(
    summary,
    "A2",
    `Exported ${new Date().toLocaleString(LOCALE.locale, { timeZone: LOCALE.timeZone })} (Manila) from the ticket database. Every figure comes from the account sheets (SUMIFS). ` +
      "Net bands = bands in minus taken back. Amount counts paid bands only. Walk-ins only: labels hidden in Settings > Tickets are left out.",
  );
  const cols = ["Staff", "Ticket type", "Price (PHP)", "Bands in", "Taken back", "Free", "Net bands", "Amount, all days (PHP)", `Amount on ${dayLabel} (PHP)`];
  head(summary, 4, cols);
  summary.getRow(4).height = 30;
  let row = 5;
  const subtotalRows: number[] = [];
  const grandResult = [0, 0, 0, 0, 0, 0];
  for (const a of accounts) {
    const { sheet, first, last } = ranges.get(a)!;
    const rg = (col: string) => `${ref(sheet)}!$${col}$${first}:$${col}$${last}`;
    const mine = lines.filter((l) => l.account === a);
    const wristbands = [...new Set(mine.map((l) => l.wristband))].sort((x, y) => rank(x) - rank(y) || x.localeCompare(y));
    const start = row;
    const sub = [0, 0, 0, 0, 0, 0];
    for (const w of wristbands) {
      const ls = mine.filter((l) => l.wristband === w);
      const bandsIn = ls.filter((l) => l.bands > 0).reduce((s, l) => s + l.bands, 0);
      const back = -ls.filter((l) => l.bands < 0).reduce((s, l) => s + l.bands, 0);
      const free = ls.reduce((s, l) => s + l.free, 0);
      const amt = ls.reduce((s, l) => s + amount(l), 0);
      const amtDay = ls.filter((l) => !l.otherDay).reduce((s, l) => s + amount(l), 0);
      const vals = [bandsIn, back, free, bandsIn - back, amt, amtDay];
      vals.forEach((v, i) => { sub[i] += v; });
      const r = summary.getRow(row);
      r.getCell(1).value = a;
      r.getCell(2).value = w;
      r.getCell(3).value = ls.find((l) => l.bands > 0)?.price ?? ls[0].price;
      r.getCell(4).value = { formula: `SUMIFS(${rg("D")},${rg("B")},$B${row},${rg("D")},">0")`, result: bandsIn };
      r.getCell(5).value = { formula: `-SUMIFS(${rg("D")},${rg("B")},$B${row},${rg("D")},"<0")`, result: back };
      r.getCell(6).value = { formula: `SUMIFS(${rg("E")},${rg("B")},$B${row})`, result: free };
      r.getCell(7).value = { formula: `D${row}-E${row}`, result: bandsIn - back };
      r.getCell(8).value = { formula: `SUMIFS(${rg("G")},${rg("B")},$B${row})`, result: amt };
      r.getCell(9).value = eventDay
        ? { formula: `SUMIFS(${rg("G")},${rg("B")},$B${row},${rg("A")},">="&DATE(${ey},${em},${ed}),${rg("A")},"<"&DATE(${ey},${em},${ed + 1}))`, result: amtDay }
        : amt;
      for (let c = 1; c <= 9; c++) {
        r.getCell(c).font = { name: FONT, color: { argb: c === 3 ? "FF0000FF" : "FF111111" } };
        r.getCell(c).numFmt = c === 3 || c >= 8 ? PESO : c >= 4 ? INT : "General";
      }
      row++;
    }
    const t = summary.getRow(row);
    t.getCell(1).value = `${a} total`;
    ["D", "E", "F", "G", "H", "I"].forEach((col, i) => {
      t.getCell(i + 4).value = { formula: `SUM(${col}${start}:${col}${row - 1})`, result: sub[i] };
      t.getCell(i + 4).numFmt = i >= 4 ? PESO : INT;
    });
    paint(t, 9, TOTAL, true, true);
    sub.forEach((v, i) => { grandResult[i] += v; });
    subtotalRows.push(row);
    row += 2; // an empty row between accounts
  }
  const g = summary.getRow(row);
  g.getCell(1).value = "All staff";
  ["D", "E", "F", "G", "H", "I"].forEach((col, i) => {
    g.getCell(i + 4).value = { formula: subtotalRows.map((r) => `${col}${r}`).join("+") || "0", result: grandResult[i] };
    g.getCell(i + 4).numFmt = i >= 4 ? PESO : INT;
  });
  paint(g, 9, GRAND, true);
  for (let c = 1; c <= 9; c++) g.getCell(c).border = { top: { style: "medium", color: { argb: "FF111827" } } };

  // Entries on other days than the event, per account: in "all days", not in the event-day column.
  let nrow = row + 2;
  for (const a of accounts) {
    const other = lines.filter((l) => l.account === a && l.otherDay);
    if (!other.length) continue;
    const days = [...new Set(other.map((l) => l.at.toLocaleDateString("en-PH", { month: "short", day: "numeric", timeZone: LOCALE.timeZone })))];
    const amt = other.reduce((s, l) => s + amount(l), 0);
    note(summary, `A${nrow}`, `${a}: ${other.length} entr${other.length === 1 ? "y" : "ies"} on other days (${days.join(", ")}), worth ₱${amt.toLocaleString("en-PH")} together; yellow rows on the account sheet.`);
    nrow++;
  }
  summary.columns.forEach((col, i) => { col.width = [16, 38, 12, 10, 11, 8, 11, 17, 17][i] ?? 12; });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}
