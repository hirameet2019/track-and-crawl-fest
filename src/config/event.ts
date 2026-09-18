/**
 * Static, non-sensitive presentation settings.
 * Event details, organizer receipt details, prices and ticket types live in the
 * database (see supabase/seed.sql) so they can be edited without a redeploy.
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "http://localhost:3000";

/** Minutes a buyer has to pay and upload proof before the order expires. */
export const PAYMENT_WINDOW_MINUTES = 30;

/**
 * Shirt sizes offered on ticket types that include a shirt (VIP Standing, VIP Car
 * Display). The list mirrors the supplier's "Regular Shirt" size chart so every
 * size the buyer can see on the chart is also selectable.
 */
export const SHIRT_SIZES = ["2XS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL", "7XL", "8XL"] as const;
export type ShirtSize = (typeof SHIRT_SIZES)[number];

/** Garment measurements in inches, transcribed from the supplier's chart image. */
export const SHIRT_SIZE_CHART: Record<ShirtSize, { width: number; length: number; sleeve: number }> = {
  "2XS": { width: 17, length: 26, sleeve: 7.5 },
  XS: { width: 18, length: 27, sleeve: 8 },
  S: { width: 19, length: 28, sleeve: 8.5 },
  M: { width: 20, length: 29, sleeve: 9.5 },
  L: { width: 21, length: 30, sleeve: 10 },
  XL: { width: 22, length: 31, sleeve: 10.5 },
  "2XL": { width: 23, length: 32, sleeve: 11 },
  "3XL": { width: 24, length: 32, sleeve: 11 },
  "4XL": { width: 25, length: 32, sleeve: 11 },
  "5XL": { width: 26, length: 32, sleeve: 11 },
  "6XL": { width: 27, length: 32, sleeve: 11 },
  "7XL": { width: 28, length: 32, sleeve: 11 },
  "8XL": { width: 29, length: 32, sleeve: 11 },
};

/** The supplier's chart image, served from /public. Shown alongside the table above. */
export const SHIRT_SIZE_CHART_IMAGE = { src: "/shirt-size-chart.png", width: 2022, height: 1465 } as const;

export function isShirtSize(value: string): value is ShirtSize {
  return (SHIRT_SIZES as readonly string[]).includes(value);
}

/** One-line description of a size, e.g. "Width 20 in · Length 29 in · Sleeve 9.5 in". */
export function shirtSizeSummary(size: ShirtSize): string {
  const m = SHIRT_SIZE_CHART[size];
  return `Width ${m.width} in · Length ${m.length} in · Sleeve ${m.sleeve} in`;
}

/** Maximum tickets per online order. */
export const MAX_QTY_PER_TYPE = 10;

/**
 * Display details per payment method. Which online channels are actually
 * offered is decided by the events row: a channel shows up on the pay page and
 * in "I paid with" only when its *_qr_url is set. Currently only GoTyme is set.
 */
export const PAYMENT_CHANNELS: Record<PaymentMethod, { label: string; accent: string; hint?: string }> = {
  gotyme: { label: "GoTyme Bank", accent: "text-teal-600", hint: "InstaPay QR. Scan with GoTyme or any bank / e-wallet app that supports InstaPay QR." },
  gcash: { label: "GCash", accent: "text-sky-700" },
  maya: { label: "Maya", accent: "text-emerald-700" },
  cash: { label: "Cash", accent: "text-zinc-700" },
};

/** Short phrase for marketing copy ("Pay via ..."). Keep in sync with the channels enabled above. */
export const PAY_VIA = "GoTyme Bank (InstaPay QR)";

import type { PaymentMethod } from "@/lib/supabase/types";
