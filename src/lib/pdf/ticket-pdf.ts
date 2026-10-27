import { BRAND as SITE_BRAND, LOCALE } from "@/config/site";
import { shirtShips, type Shipping } from "@/lib/shipping";
import { vehicleWords } from "@/lib/vehicle";
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "fs/promises";
import { createAdminClient } from "@/lib/supabase/admin";
import path from "path";
import QRCode from "qrcode";
import { SITE_URL } from "@/config/event";
import type { OrderBundle } from "@/lib/queries";
import { carNameOf, itemLabel } from "@/lib/items";
import { getSiteSettings } from "@/lib/site-settings";
import { paymentLabel } from "@/lib/payment-options";

const A4: [number, number] = [595.28, 841.89];

/**
 * pdf-lib's standard fonts only encode WinAnsi. The peso sign (U+20B1) is not in
 * WinAnsi, so amounts are rendered as "PHP 1,234.56" and any other unsupported
 * character is replaced before drawing.
 */
function php(centavos: number): string {
  return `${LOCALE.currencyCode} ` + new Intl.NumberFormat(LOCALE.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(centavos / 100);
}
function safe(s: string): string {
  // Printable ASCII, Latin-1 supplement, and the few typographic marks WinAnsi has.
  return s.replace(/[^\x20-\x7E\xA0-\xFF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026]/g, "?");
}
const MARGIN = 48;

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  /** Orbitron Black: wordmark, ticket numbers, badges */
  display: PDFFont;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "TBA";
  return new Date(iso).toLocaleString(LOCALE.locale, {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: LOCALE.timeZone,
  });
}

function text(page: PDFPage, s: string, x: number, y: number, size: number, font: PDFFont, color = rgb(0.1, 0.1, 0.1)) {
  page.drawText(safe(s), { x, y, size, font, color });
}

function rightText(page: PDFPage, s: string, rightX: number, y: number, size: number, font: PDFFont) {
  const t = safe(s);
  const w = font.widthOfTextAtSize(t, size);
  text(page, t, rightX - w, y, size, font);
}

async function qrPng(data: string): Promise<Uint8Array> {
  const buf = await QRCode.toBuffer(data, { errorCorrectionLevel: "M", margin: 1, width: 512 });
  return new Uint8Array(buf);
}

export function ticketUrl(token: string): string {
  return `${SITE_URL}/t/${token}`;
}

/* ------------------------------------------------------------- receipt */
const INK = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.42, 0.42, 0.46);
const LINE = rgb(0.82, 0.82, 0.85);
const PANEL = rgb(0.96, 0.96, 0.97);
const DARK = rgb(0.08, 0.08, 0.1);
const ACCENT = rgb(0.95, 0.62, 0.05);
const WHITE = rgb(1, 1, 1);

/** Greedy word wrap that respects the font's real glyph widths. */
function wrap(font: PDFFont, s: string, size: number, maxWidth: number): string[] {
  const words = safe(s).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= maxWidth || !cur) cur = next;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Draws wrapped text and returns the y position below the last line. */
function paragraph(page: PDFPage, s: string, x: number, y: number, size: number, font: PDFFont, maxWidth: number, color = INK, leading = 1.3): number {
  let yy = y;
  for (const line of wrap(font, s, size, maxWidth)) {
    text(page, line, x, yy, size, font, color);
    yy -= size * leading;
  }
  return yy;
}

function rightTextColor(page: PDFPage, s: string, rightX: number, y: number, size: number, font: PDFFont, color: ReturnType<typeof rgb>) {
  const t = safe(s);
  page.drawText(t, { x: rightX - font.widthOfTextAtSize(t, size), y, size, font, color });
}

function drawReceiptPage(doc: PDFDocument, f: Fonts, b: OrderBundle) {
  const page = doc.addPage(A4);
  const { event, order, items } = b;
  const W = A4[0], right = W - MARGIN, contentW = W - 2 * MARGIN;

  // Accent stripe across the top
  page.drawRectangle({ x: 0, y: A4[1] - 14, width: W, height: 14, color: DARK });
  page.drawRectangle({ x: 0, y: A4[1] - 18, width: W, height: 4, color: ACCENT });

  // ---- Header: organizer (left, wraps) and receipt box (right)
  const boxW = 210, boxH = 78;
  const boxX = right - boxW, boxY = A4[1] - MARGIN - 20 - boxH;
  let y = A4[1] - MARGIN - 20;
  const orgW = contentW - boxW - 24;

  y = paragraph(page, event.org_name, MARGIN, y - 4, 15, f.bold, orgW, INK, 1.2);
  y -= 2;
  if (event.org_address) y = paragraph(page, event.org_address, MARGIN, y, 9.5, f.regular, orgW, MUTED);
  if (event.org_tin) {
    text(page, `TIN ${event.org_tin}  |  ${event.org_vat_registered ? "VAT Registered" : "Non-VAT"}`, MARGIN, y, 9.5, f.regular, MUTED);
    y -= 12;
  }

  page.drawRectangle({ x: boxX, y: boxY, width: boxW, height: boxH, color: PANEL, borderColor: LINE, borderWidth: 0.8 });
  page.drawRectangle({ x: boxX, y: boxY + boxH - 24, width: boxW, height: 24, color: DARK });
  {
    const label = safe(event.receipt_label.toUpperCase());
    let size = 11;
    while (f.bold.widthOfTextAtSize(label, size) > boxW - 20 && size > 7) size -= 0.5;
    const lw = f.bold.widthOfTextAtSize(label, size);
    page.drawText(label, { x: boxX + (boxW - lw) / 2, y: boxY + boxH - 16.5, size, font: f.bold, color: WHITE });
  }
  text(page, "No.", boxX + 12, boxY + 34, 8.5, f.regular, MUTED);
  text(page, String(order.receipt_no ?? 0).padStart(6, "0"), boxX + 12, boxY + 16, 16, f.bold, INK);
  const dateStr = fmtDate(order.paid_at ?? order.created_at);
  rightTextColor(page, "Date", boxX + boxW - 12, boxY + 40, 8.5, f.regular, MUTED);
  rightTextColor(page, dateStr, boxX + boxW - 12, boxY + 28, 8.5, f.bold, INK);
  rightTextColor(page, `Order #${order.order_no}`, boxX + boxW - 12, boxY + 14, 8.5, f.regular, MUTED);

  y = Math.min(y, boxY) - 22;

  // ---- Two panels: Received from | Event
  const panelH = 88, gap = 16, panelW = (contentW - gap) / 2;
  const py = y - panelH;
  ["RECEIVED FROM", "EVENT"].forEach((title, i) => {
    const px = MARGIN + i * (panelW + gap);
    page.drawRectangle({ x: px, y: py, width: panelW, height: panelH, color: PANEL });
    page.drawRectangle({ x: px, y: py, width: 3, height: panelH, color: ACCENT });
    text(page, title, px + 12, py + panelH - 16, 8, f.bold, MUTED);
  });
  {
    const px = MARGIN + 12, innerW = panelW - 24;
    let yy = py + panelH - 32;
    yy = paragraph(page, order.buyer_name, px, yy, 11.5, f.bold, innerW);
    if (order.buyer_email) yy = paragraph(page, order.buyer_email, px, yy, 9.5, f.regular, innerW, MUTED);
    if (order.buyer_mobile) paragraph(page, order.buyer_mobile, px, yy, 9.5, f.regular, innerW, MUTED);
  }
  {
    const px = MARGIN + panelW + gap + 12, innerW = panelW - 24;
    let yy = py + panelH - 32;
    yy = paragraph(page, event.name, px, yy, 11.5, f.bold, innerW);
    yy = paragraph(page, fmtDate(event.starts_at), px, yy, 9.5, f.regular, innerW, MUTED);
    if (event.venue) paragraph(page, event.venue, px, yy, 9.5, f.regular, innerW, MUTED);
  }
  y = py - 26;

  // ---- Items table
  const colQty = MARGIN + 330, colUnit = MARGIN + 415, colAmt = right - 10;
  page.drawRectangle({ x: MARGIN, y: y - 6, width: contentW, height: 22, color: DARK });
  page.drawText("DESCRIPTION", { x: MARGIN + 10, y, size: 8.5, font: f.bold, color: WHITE });
  rightTextColor(page, "QTY", colQty, y, 8.5, f.bold, WHITE);
  rightTextColor(page, "UNIT PRICE", colUnit, y, 8.5, f.bold, WHITE);
  rightTextColor(page, "AMOUNT", colAmt, y, 8.5, f.bold, WHITE);
  y -= 6;

  let rowIdx = 0;
  for (const it of items) {
    const descLines = wrap(f.regular, itemLabel(it, false, carNameOf(b.items)), 10, colQty - MARGIN - 60);
    const rowH = Math.max(24, 10 + descLines.length * 13);
    if (rowIdx % 2 === 1) page.drawRectangle({ x: MARGIN, y: y - rowH, width: contentW, height: rowH, color: PANEL });
    let ty = y - 16;
    for (const l of descLines) { text(page, l, MARGIN + 10, ty, 10, f.regular); ty -= 13; }
    rightText(page, String(it.qty), colQty, y - 16, 10, f.regular);
    rightText(page, php(it.unit_price_centavos), colUnit, y - 16, 10, f.regular);
    rightText(page, php(it.qty * it.unit_price_centavos), colAmt, y - 16, 10, f.bold);
    y -= rowH;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: right, y }, thickness: 0.5, color: LINE });
    rowIdx++;
  }

  // ---- Totals box (right) and payment (left)
  y -= 30;
  const total = order.total_centavos;
  const totW = 230, totX = right - totW;
  const rows: [string, string][] = [];
  if (event.org_vat_registered) {
    const vatable = Math.round(total / 1.12);
    rows.push(["VATable Sales", php(vatable)]);
    rows.push(["VAT (12%)", php(total - vatable)]);
  } else {
    rows.push(["Subtotal", php(total)]);
  }
  let ty = y;
  for (const [label, val] of rows) {
    text(page, label, totX, ty, 9.5, f.regular, MUTED);
    rightText(page, val, right, ty, 9.5, f.regular);
    ty -= 15;
  }
  page.drawRectangle({ x: totX - 10, y: ty - 12, width: totW + 10, height: 26, color: DARK });
  page.drawText("TOTAL PAID", { x: totX, y: ty - 4, size: 9.5, font: f.bold, color: WHITE });
  rightTextColor(page, php(total), right, ty - 4.5, 13, f.bold, WHITE);

  text(page, "PAYMENT", MARGIN, y, 8, f.bold, MUTED);
  text(page, (order.payment_method ? paymentLabel(order) : "").toUpperCase(), MARGIN, y - 15, 11, f.bold);
  if (order.payment_reference) text(page, `Ref. ${order.payment_reference}`, MARGIN, y - 29, 9.5, f.regular, MUTED);
  text(page, `Paid ${dateStr}`, MARGIN, y - 42, 9.5, f.regular, MUTED);

  // ---- Footer
  const fy = 96;
  page.drawLine({ start: { x: MARGIN, y: fy + 30 }, end: { x: right, y: fy + 30 }, thickness: 0.6, color: LINE });
  let fyy = fy + 16;
  fyy = paragraph(page, "Thank you for registering. Your registration passes follow on the next pages, one for each car or motorcycle. Present each QR code at the venue gate and staff will hand you the matching numbered wristband and vehicle pass.", MARGIN, fyy, 8.5, f.regular, contentW, MUTED);
  if (event.refund_policy) fyy = paragraph(page, `Refund policy: ${event.refund_policy}`, MARGIN, fyy - 2, 8.5, f.regular, contentW, MUTED);
  text(page, "This is a system-generated document and does not require a signature.", MARGIN, fyy - 4, 7.5, f.regular, MUTED);
}

/* -------------------------------------------------------------- ticket */
/** "#ff3fd1" or "#f3d" to a pdf-lib colour; null when it is not a hex colour. */
function hexRgb(hex: string): ReturnType<typeof rgb> | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255);
}

/** The PDF's own colours, each overridable from SITE_BRAND.pdf.palette. */
const PDF_DEFAULTS = {
  pink: rgb(1, 0.37, 0.85),
  pinkDark: rgb(0.29, 0.02, 0.31),
  green: rgb(0.36, 0.99, 0.48),
  cyan: rgb(0.16, 0.85, 1),
  teal: rgb(0.02, 0.21, 0.23),
  gold: rgb(1, 0.82, 0.25),
  goldDark: rgb(0.23, 0.14, 0),
  violet: rgb(0.7, 0.3, 1),
};
type PdfColors = typeof PDF_DEFAULTS;

/**
 * The PDF palette for one document: built-in colours, then the code override
 * (site.ts C.pdf.palette), then what was saved in Admin > Settings.
 */
function pdfColors(saved: Partial<Record<string, string>>): PdfColors {
  const code = SITE_BRAND.pdf.palette as Partial<Record<string, string>>;
  return Object.fromEntries(
    Object.entries(PDF_DEFAULTS).map(([k, v]) => {
      const o = saved[k] ?? code[k];
      return [k, (o && hexRgb(o)) || v];
    }),
  ) as PdfColors;
}

const BAND_COLORS: Record<string, ReturnType<typeof rgb>> = {
  green: rgb(0.13, 0.77, 0.37),
  yellow: rgb(0.98, 0.85, 0.2),
  gold: rgb(0.85, 0.65, 0.13),
  black: rgb(0.1, 0.1, 0.1),
  red: rgb(0.86, 0.15, 0.15),
  blue: rgb(0.15, 0.4, 0.9),
  orange: rgb(0.98, 0.55, 0.1),
  white: rgb(0.95, 0.95, 0.95),
  purple: rgb(0.55, 0.25, 0.85),
  pink: rgb(0.95, 0.4, 0.7),
};

// Embed each image once per document; drawing reuses the same XObject on every page.
const embedded = new WeakMap<PDFDocument, Map<string, PDFImage>>();
async function embedOnce(doc: PDFDocument, key: string, make: () => Promise<PDFImage>): Promise<PDFImage> {
  let m = embedded.get(doc);
  if (!m) { m = new Map(); embedded.set(doc, m); }
  let img = m.get(key);
  if (!img) { img = await make(); m.set(key, img); }
  return img;
}

/** Where the PDF's logo and banner come from for this document. */
interface PdfArt {
  logo: string;
  banner: string;
  colors: PdfColors;
}

/**
 * Bytes of a logo or banner, kept for the life of the server instance. The source
 * is an uploaded https URL (Admin > Settings), a /public path, or a path from the
 * project root (the built-in files). Null when it cannot be read; a failed
 * download is not remembered, so the next PDF tries again.
 */
const artCache = new Map<string, Promise<Uint8Array | null>>();
function artBytes(source: string): Promise<Uint8Array | null> {
  let p = artCache.get(source);
  if (!p) {
    p = (async () => {
      try {
        if (/^https:\/\//.test(source)) {
          const res = await fetch(source, { signal: AbortSignal.timeout(10_000) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return new Uint8Array(await res.arrayBuffer());
        }
        // The built-in files ship via outputFileTracingIncludes (next.config.ts). Without the
        // ignore hints, this runtime path makes Turbopack trace the whole project, public
        // folder and hero video included, into every server function.
        const file = source.startsWith("/")
          ? path.join(/*turbopackIgnore: true*/ process.cwd(), "public", source)
          : path.join(/*turbopackIgnore: true*/ process.cwd(), source);
        return new Uint8Array(await readFile(file));
      } catch (e) {
        console.warn(`[pdf] artwork skipped (${source}):`, e instanceof Error ? e.message : e);
        if (/^https:/.test(source)) artCache.delete(source);
        return null;
      }
    })();
    artCache.set(source, p);
  }
  return p;
}

/** Embed a PNG or JPG once per document, by content. Null if missing or another format. */
async function embedArt(doc: PDFDocument, source: string): Promise<PDFImage | null> {
  const bytes = await artBytes(source);
  if (!bytes) return null;
  try {
    return await embedOnce(doc, `art:${source}`, () => {
      const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
      return isPng ? doc.embedPng(bytes) : doc.embedJpg(bytes);
    });
  } catch (e) {
    console.warn(`[pdf] artwork not PNG/JPG (${source}):`, e instanceof Error ? e.message : e);
    return null;
  }
}

/** Text with a fake outline: the same string drawn around the fill in the outline colour. */
function outlined(page: PDFPage, s: string, x: number, y: number, size: number, font: PDFFont, fill: ReturnType<typeof rgb>, outline: ReturnType<typeof rgb>, thick = 1.6) {
  const t = safe(s);
  // pdf-lib: ySkew slants the letters (italic); xSkew would tilt the whole baseline.
  const skew = degrees(12);
  for (const [dx, dy] of [[-thick, 0], [thick, 0], [0, -thick], [0, thick], [-thick, -thick], [thick, thick], [-thick, thick], [thick, -thick]]) {
    page.drawText(t, { x: x + dx, y: y + dy, size, font, color: outline, ySkew: skew });
  }
  page.drawText(t, { x, y, size, font, color: fill, ySkew: skew });
}

/**
 * Text wordmark for when there is no logo PNG: the event name in Orbitron, at
 * most three lines, alternating the first two palette colours, with a gold
 * dashed rule under it. Shrinks until the longest word fits the width.
 */
function drawWordmark(page: PDFPage, f: Fonts, name: string, x: number, topY: number, width: number, C: PdfColors) {
  const scale = width / 300;
  const words = safe(name.toUpperCase()).split(/\s+/).filter(Boolean);
  let size = 34 * scale;
  let lines: string[] = [];
  for (; size > 10 * scale; size -= 2 * scale) {
    lines = wrap(f.display, words.join(" "), size, width);
    if (lines.length <= 3 && lines.every((l) => f.display.widthOfTextAtSize(l, size) <= width)) break;
  }
  const fills = [[C.pink, C.pinkDark], [C.green, C.teal]] as const;
  let y = topY;
  lines.slice(0, 3).forEach((line, i) => {
    y -= size + (i ? 6 * scale : 0);
    const [fill, edge] = fills[i % 2];
    outlined(page, line, x, y, size, f.display, fill, edge, 1.8 * scale);
  });
  y -= 10 * scale;
  page.drawLine({ start: { x, y }, end: { x: x + width, y }, thickness: 2 * scale, color: C.gold, dashArray: [10 * scale, 5 * scale] });
  return y;
}

/** Event wordmark: the logo PNG from site.ts when available, else the event name in Orbitron. */
async function drawBrand(doc: PDFDocument, page: PDFPage, f: Fonts, logo: string, name: string, x: number, topY: number, width: number, C: PdfColors): Promise<{ bottom: number; width: number }> {
  const img = await embedArt(doc, logo);
  if (img) {
    const h = (img.height / img.width) * width;
    page.drawImage(img, { x, y: topY - h, width, height: h });
    return { bottom: topY - h, width };
  }
  const bottom = drawWordmark(page, f, name, x, topY, width, C);
  return { bottom, width };
}

/** Four-colour brand stripe. */
function stripe(page: PDFPage, x: number, y: number, w: number, h: number, C: PdfColors) {
  const cols = [C.pink, C.violet, C.cyan, C.green];
  cols.forEach((c, i) => page.drawRectangle({ x: x + (w / cols.length) * i, y, width: w / cols.length, height: h, color: c }));
}

function labelValue(page: PDFPage, f: Fonts, label: string, value: string, x: number, y: number, valueSize = 12) {
  text(page, label, x, y, 7.5, f.bold, MUTED);
  text(page, value, x, y - valueSize - 3, valueSize, f.bold, INK);
  return y - valueSize - 19;
}

async function drawTicketPage(doc: PDFDocument, f: Fonts, b: OrderBundle, t: OrderBundle["tickets"][number], art: PdfArt) {
  const C = art.colors;
  const page = doc.addPage(A4);
  const { event, order } = b;
  const tt = t.ticket_type;
  const W = A4[0], H = A4[1], right = W - MARGIN, contentW = W - 2 * MARGIN;
  const isVip = tt.includes_shirt || tt.includes_car_pass;
  // A passenger riding with a car wears a car wristband but drives nothing: no plate
  // block, no car pass stub, no car photo.
  const isCarPass = tt.includes_car_pass && !t.companion_of;
  // "Car" or "Motorcycle", from the ticket name, for the pass and its stub.
  const vehicle = vehicleWords(tt).noun;
  const Vehicle = vehicle[0].toUpperCase() + vehicle.slice(1);
  /** What this ticket is called on the badges: a bundled passenger is not a car. */
  const typeLabel = t.companion_of && t.included && tt.requires_vehicle ? "VIP Car Passenger" : tt.name;

  // ---------------------------------------------------------- banner
  const bannerH = 222;
  const bannerY = H - bannerH;
  page.drawRectangle({ x: 0, y: bannerY, width: W, height: bannerH, color: rgb(0.05, 0.03, 0.09) });
  const img = await embedArt(doc, art.banner);
  if (img) {
    const scale = Math.max(W / img.width, bannerH / img.height) * 1.05;
    const iw = img.width * scale, ih = img.height * scale;
    page.drawImage(img, { x: (W - iw) / 2, y: bannerY + bannerH - ih + ih * 0.12, width: iw, height: ih });
    // cover anything that bled below the banner
    page.drawRectangle({ x: 0, y: 0, width: W, height: bannerY, color: WHITE });
  }
  // darken for legibility: stronger at the bottom of the banner
  page.drawRectangle({ x: 0, y: bannerY, width: W, height: bannerH, color: rgb(0, 0, 0), opacity: 0.42 });
  page.drawRectangle({ x: 0, y: bannerY, width: W, height: 110, color: rgb(0, 0, 0), opacity: 0.35 });
  stripe(page, 0, bannerY - 4, W, 4, C);

  // wordmark + event meta
  const brand = await drawBrand(doc, page, f, art.logo, event.name, MARGIN, H - 30, 300, C);
  const wmBottom = brand.bottom;
  page.drawText(safe(fmtDate(event.starts_at)), { x: MARGIN, y: wmBottom - 22, size: 9.5, font: f.bold, color: WHITE });
  if (event.venue) page.drawText(safe(event.venue), { x: MARGIN, y: wmBottom - 35, size: 9, font: f.regular, color: rgb(0.85, 0.85, 0.9) });

  // ticket type badge (top right)
  {
    const label = safe(typeLabel.toUpperCase());
    let size = 13;
    while (f.display.widthOfTextAtSize(label, size) > 210 && size > 8) size -= 0.5;
    const bw = f.display.widthOfTextAtSize(label, size) + 28, bh = 30;
    const bx = right - bw, by = H - 34 - bh;
    page.drawRectangle({ x: bx, y: by, width: bw, height: bh, color: isVip ? C.gold : C.cyan });
    page.drawText(label, { x: bx + 14, y: by + 9.5, size, font: f.display, color: rgb(0.05, 0.05, 0.08) });
    page.drawText("ADMIT ONE", { x: right - f.bold.widthOfTextAtSize("ADMIT ONE", 8), y: by - 14, size: 8, font: f.bold, color: rgb(0.9, 0.9, 0.95) });
  }

  // ---------------------------------------------------------- body card
  const cardTop = bannerY - 24, cardBottom = 204;
  page.drawRectangle({ x: MARGIN, y: cardBottom, width: contentW, height: cardTop - cardBottom, color: WHITE, borderColor: LINE, borderWidth: 0.8 });
  page.drawRectangle({ x: MARGIN, y: cardBottom, width: 5, height: cardTop - cardBottom, color: isVip ? C.gold : C.cyan });

  // left: wristband number + details
  const lx = MARGIN + 24;
  let y = cardTop - 26;
  text(page, "WRISTBAND / TICKET NO.", lx, y, 7.5, f.bold, MUTED);
  y -= 42;
  {
    // shrink to fit between the left edge and the QR panel
    const maxW = right - 20 - 224 - 16 - lx;
    let size = 38;
    while (f.display.widthOfTextAtSize(safe(t.number), size) > maxW && size > 14) size -= 1;
    page.drawText(safe(t.number), { x: lx, y: y + (38 - size) * 0.3, size, font: f.display, color: INK });
  }
  y -= 18;
  if (tt.band_color) {
    const key = tt.band_color.toLowerCase();
    const c = Object.keys(BAND_COLORS).find((k) => key.includes(k));
    page.drawRectangle({ x: lx, y: y - 2, width: 12, height: 12, color: c ? BAND_COLORS[c] : rgb(0.6, 0.6, 0.6), borderColor: rgb(0.3, 0.3, 0.3), borderWidth: 0.5 });
    text(page, `${tt.band_color} wristband`, lx + 18, y, 10, f.regular, INK);
  }
  y -= 30;
  y = labelValue(page, f, isCarPass ? vehicleWords(tt).person.toUpperCase() : "HOLDER", t.holder_name ?? order.buyer_name, lx, y, 13);
  // A shirt that ships is not handed over at the gate; say so on the ticket.
  const shipped = shirtShips(tt, order);
  if (tt.includes_shirt && !t.included) {
    y = labelValue(page, f, shipped ? "T-SHIRT SIZE (SHIPPED)" : "T-SHIRT SIZE", `${t.shirt_size ?? "Not specified"}${shipped ? ` · ${(order.shipping as Shipping).courier}` : ""}`, lx, y);
  }
  if (tt.requires_vehicle && !t.companion_of) {
    y = labelValue(page, f, "VEHICLE PLATE", t.vehicle_plate ?? "Not specified", lx, y);
    y = labelValue(page, f, "VEHICLE", t.vehicle_model ?? "Not specified", lx, y);
    const riders = b.tickets.filter((x) => x.companion_of && plateKey(x.companion_of) === plateKey(t.vehicle_plate));
    if (riders.length) y = labelValue(page, f, "COMPANIONS", `${riders.length}: ${riders.map((r) => r.holder_name ?? "").join(", ")}`, lx, y);
  }
  if (t.companion_of) y = labelValue(page, f, t.included ? "PASSENGER OF CAR (INCLUDED)" : "RIDING WITH CAR", t.companion_of, lx, y);
  y = labelValue(page, f, "ORDER", `#${order.order_no}`, lx, y);
  const includes: string[] = [];
  if (tt.includes_shirt && !t.included) includes.push(shipped ? "Event T-shirt (shipped to you)" : "Event T-shirt");
  if (tt.includes_lanyard) includes.push("ID Lanyard");
  if (tt.includes_sticker) includes.push(isCarPass ? "2 Event Decals" : "Event Decal");
  if (isCarPass) includes.push(`${Vehicle} Pass`);

  // gate steps, anchored to the bottom of the card
  {
    const steps: [string, string][] = [
      ["1", "Show this QR code at the gate, on your phone or printed."],
      ["2", "Staff scan it once. A second scan is refused."],
      ["3", includes.length ? `Receive your ${tt.band_color ? tt.band_color.toLowerCase() + " " : ""}wristband and: ${includes.join(", ")}.` : `Receive your ${tt.band_color ? tt.band_color.toLowerCase() + " " : ""}wristband and keep it on all day.`],
    ];
    const boxX = lx - 8, boxW = right - 20 - 224 - 12 - boxX, boxY = cardBottom + 14;
    // Size the box from its content; shrink the type a notch if the fields above leave little room.
    const room = y - 12 - boxY;
    let fs = 8.5;
    const measure = (size: number) => 34 + steps.reduce((h, [, line]) => h + wrap(f.regular, line, size, boxW - 44).length * size * 1.25 + 4, 0);
    while (measure(fs) > room && fs > 7) fs -= 0.5;
    const boxH = Math.min(measure(fs), Math.max(room, 40));
    page.drawRectangle({ x: boxX, y: boxY, width: boxW, height: boxH, color: PANEL });
    page.drawText("AT THE GATE", { x: boxX + 12, y: boxY + boxH - 17, size: 8, font: f.display, color: INK });
    let sy = boxY + boxH - 34;
    for (const [num, line] of steps) {
      page.drawRectangle({ x: boxX + 12, y: sy - 3, width: 14, height: 14, color: isVip ? C.gold : C.cyan });
      page.drawText(num, { x: boxX + 16, y: sy, size: fs, font: f.display, color: rgb(0.05, 0.05, 0.08) });
      const end = paragraph(page, line, boxX + 32, sy, fs, f.regular, boxW - 44, INK, 1.25);
      sy = end - 4;
    }
  }

  // right: QR panel
  const qrPng = await doc.embedPng(await qrPngBytes(ticketUrl(t.qr_token)));
  const panelW = 224, panelH = 262;
  const px = right - 20 - panelW, py = cardTop - 22 - panelH;
  page.drawRectangle({ x: px, y: py, width: panelW, height: panelH, color: PANEL, borderColor: LINE, borderWidth: 0.6 });
  const qrSize = 196;
  page.drawRectangle({ x: px + (panelW - qrSize) / 2 - 6, y: py + panelH - qrSize - 20, width: qrSize + 12, height: qrSize + 12, color: WHITE });
  page.drawImage(qrPng, { x: px + (panelW - qrSize) / 2, y: py + panelH - qrSize - 14, width: qrSize, height: qrSize });
  const cap = "SCAN AT THE GATE";
  page.drawText(cap, { x: px + (panelW - f.display.widthOfTextAtSize(cap, 9)) / 2, y: py + 22, size: 9, font: f.display, color: INK });
  const cap2 = "Show on your phone or printed";
  text(page, cap2, px + (panelW - f.regular.widthOfTextAtSize(cap2, 7.5)) / 2, py + 10, 7.5, f.regular, MUTED);

  // ---------------------------------------------------------- stub (perforated)
  const stubTop = cardBottom - 18;
  page.drawLine({ start: { x: MARGIN, y: stubTop }, end: { x: right, y: stubTop }, thickness: 0.8, color: rgb(0.55, 0.55, 0.6), dashArray: [4, 4] });
  text(page, isCarPass ? (vehicle === "car" ? "CAR PASS  -  cut along the line and display on the dashboard" : `${vehicle.toUpperCase()} PASS  -  cut along the line and keep it with the ${vehicle}`) : "STUB  -  cut along the line and keep", MARGIN, stubTop - 12, 7.5, f.bold, MUTED);

  const sY = 70, sH = stubTop - 24 - sY;
  page.drawRectangle({ x: MARGIN, y: sY, width: contentW, height: sH, color: rgb(0.05, 0.03, 0.09) });
  stripe(page, MARGIN, sY + sH - 4, contentW, 4, C);
  // Car pass stubs show the registered car instead of the logo, so marshals can match it.
  let sx = MARGIN + 14 + 150 + 22;
  const carImg = isCarPass && t.vehicle_photo_path ? await vehiclePhoto(doc, t.vehicle_photo_path) : null;
  if (carImg) {
    const ph = sH - 16, pw = Math.min(160, ph * (carImg.width / carImg.height));
    page.drawRectangle({ x: MARGIN + 12, y: sY + 6, width: pw + 4, height: ph + 4, color: WHITE });
    page.drawImage(carImg, { x: MARGIN + 14, y: sY + 8, width: pw, height: ph });
    sx = MARGIN + 14 + pw + 22;
  } else {
    const brandW = 150;
    await drawBrand(doc, page, f, art.logo, event.name, MARGIN + 14, sY + sH - 4 - (sH - 8 - brandW * 0.33) / 2, brandW, C);
  }
  const bigText = isCarPass ? (t.vehicle_plate ?? "PLATE TBA") : t.number;
  const smallText = isCarPass
    ? `${t.vehicle_model ?? ""}   |   ${t.holder_name ?? order.buyer_name}   |   Band ${t.number}`
    : `${typeLabel}${t.companion_of ? ` (${t.included ? "passenger" : "companion"} of ${t.companion_of})` : ""}   |   ${t.holder_name ?? order.buyer_name}   |   Order #${order.order_no}`;
  {
    const maxW = right - 12 - (sH - 20) - 24 - sx;
    let size = 26;
    while (f.display.widthOfTextAtSize(safe(bigText), size) > maxW && size > 12) size -= 1;
    page.drawText(safe(bigText), { x: sx, y: sY + sH / 2 - 2, size, font: f.display, color: WHITE });
    paragraph(page, smallText, sx, sY + sH / 2 - 16, 7.5, f.regular, maxW, rgb(0.85, 0.85, 0.9), 1.2);
  }
  // right side of stub: type badge + small QR
  const sq = sH - 20;
  page.drawRectangle({ x: right - 12 - sq - 6, y: sY + 10 - 3, width: sq + 12, height: sq + 6, color: WHITE });
  page.drawImage(qrPng, { x: right - 12 - sq, y: sY + 10, width: sq, height: sq });
  {
    const label = safe(typeLabel.toUpperCase());
    let size = 9;
    while (f.display.widthOfTextAtSize(label, size) > 150 && size > 6) size -= 0.5;
    const tx = right - 12 - sq - 18 - f.display.widthOfTextAtSize(label, size);
    page.drawText(label, { x: tx, y: sY + sH - 22, size, font: f.display, color: isVip ? C.gold : C.cyan });
  }

  // ---------------------------------------------------------- void stamp
  if (t.status === "void") {
    const RED = rgb(0.8, 0.1, 0.1);
    // hide the QR codes so a voided page cannot be mistaken for a live one
    page.drawRectangle({ x: px, y: py, width: panelW, height: panelH, color: PANEL, borderColor: LINE, borderWidth: 0.6 });
    const v = "VOID";
    const vs = 44;
    page.drawText(v, { x: px + (panelW - f.display.widthOfTextAtSize(v, vs)) / 2, y: py + panelH / 2 + 10, size: vs, font: f.display, color: RED });
    const why = wrap(f.regular, `Not valid for entry. ${t.void_reason ?? ""}`.trim(), 8.5, panelW - 24);
    let wy = py + panelH / 2 - 14;
    for (const line of why.slice(0, 4)) { text(page, line, px + (panelW - f.regular.widthOfTextAtSize(line, 8.5)) / 2, wy, 8.5, f.regular, INK); wy -= 11; }
    page.drawRectangle({ x: right - 12 - sq, y: sY + 10, width: sq, height: sq, color: rgb(0.05, 0.03, 0.09) });
    // big diagonal watermark across the body card and the stub
    for (const [cx, cy] of [[W / 2, (cardTop + cardBottom) / 2], [W / 2, sY + sH / 2]] as [number, number][]) {
      const size = cx === W / 2 && cy > 300 ? 150 : 70;
      const tw = f.display.widthOfTextAtSize(v, size);
      page.drawText(v, { x: cx - tw * 0.42, y: cy - size * 0.55, size, font: f.display, color: RED, opacity: 0.28, rotate: degrees(22) });
    }
  }

  // ---------------------------------------------------------- footer
  text(
    page,
    isCarPass
      ? `Good for one entry of this ${vehicle}. Keep your wristband on and the pass with the ${vehicle} all day. Do not share screenshots of this QR code.`
      : "Each QR code admits one person once. Keep your wristband on for the whole event. Do not share screenshots of your QR code.",
    MARGIN, 44, 7.5, f.regular, MUTED,
  );
  text(page, `Ticket ID ${t.id}   |   ${safe(event.org_name)}`, MARGIN, 32, 7, f.regular, rgb(0.6, 0.6, 0.65));
}

/** Buyer-uploaded car photo from the private bucket, embedded once per document. Null on any failure. */
async function vehiclePhoto(doc: PDFDocument, storagePath: string): Promise<PDFImage | null> {
  try {
    return await embedOnce(doc, `car:${storagePath}`, async () => {
      const { data, error } = await createAdminClient().storage.from("vehicle-photos").download(storagePath);
      if (error || !data) throw new Error(error?.message ?? "no photo");
      const bytes = new Uint8Array(await data.arrayBuffer());
      const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
      return isPng ? doc.embedPng(bytes) : doc.embedJpg(bytes);
    });
  } catch (e) {
    console.warn(`[pdf] car photo skipped (${storagePath}):`, e instanceof Error ? e.message : e);
    return null;
  }
}

const plateKey = (p: string | null | undefined) => (p ?? "").replace(/\s+/g, "").toUpperCase();

async function qrPngBytes(data: string): Promise<Uint8Array> {
  return qrPng(data);
}

/** Builds the PDF: page 1 receipt, then one page per ticket. Returns bytes. */
export async function buildOrderPdf(bundle: OrderBundle): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const display = await doc.embedFont(await readFile(path.join(process.cwd(), "src", "lib", "pdf", "fonts", "Orbitron-Black.ttf")), { subset: true });
  const f: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    display,
  };
  doc.setTitle(`${bundle.event.name} - Order #${bundle.order.order_no}`);
  // Uploaded artwork from Admin > Settings, else the files that ship with the app.
  const site = await getSiteSettings();
  const art: PdfArt = { logo: site.pdfLogo ?? SITE_BRAND.pdf.logo, banner: site.pdfBanner ?? SITE_BRAND.pdf.banner, colors: pdfColors(site.pdfPalette) };
  drawReceiptPage(doc, f, bundle);
  // A ticket converted to another type gave its band back to the pool; it is not the
  // buyer's any more, so it gets no page. Ordinary voids keep theirs, stamped VOID.
  for (const t of bundle.tickets.filter((t) => t.ticket_number_id !== null)) await drawTicketPage(doc, f, bundle, t, art);
  return doc.save();
}
