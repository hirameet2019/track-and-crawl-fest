/**
 * Business rules: payment window, order limits, shirt sizes, payment channels.
 * Branding, artwork, colours and locale are in src/config/site.ts. Event details,
 * receipt details, prices and ticket types live in the database so staff can edit
 * them in Admin without a redeploy.
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "http://localhost:3000";

/** Minutes a buyer has to pay and upload proof before the order expires. */
export const PAYMENT_WINDOW_MINUTES = 60;
/**
 * Expiry is final: once the hold lapses the wristbands go straight back to the
 * pool and the order cannot be revived by the buyer. Organizer's decision, taken
 * to keep wristband inventory unambiguous.
 *
 * The case this gives up on is the buyer who paid at minute 58 and uploaded at
 * minute 62. They are sent to the support contact on the events row instead, so
 * make sure that contact is always set while sales are open.
 */
/**
 * How long before the hold runs out the reminder email goes. Late enough that
 * the buyer has had a real go at paying, early enough to still act on it.
 * Keep it comfortably above the cron interval or a run can skip an order.
 */
export const REMINDER_MINUTES_BEFORE_EXPIRY = 15;
/**
 * Upper age on the "your hold expired" notice. If the cron is paused or the
 * deploy is rolled back for a day, the backlog must not all go out at once:
 * a notice about a hold that lapsed hours ago is noise, not help.
 */
export const EXPIRY_NOTICE_MAX_AGE_HOURS = 3;

/**
 * Shirt sizes offered on ticket types that include a shirt (VIP Pass, VIP Car
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
/** Passengers that can be added inside one VIP Car Display ticket. */
export const MAX_COMPANIONS_PER_CAR = 12;

/**
 * Display details per payment method. Which online channels are actually
 * offered is decided by the events row: a channel shows up on the pay page and
 * in "I paid with" only when its *_qr_url is set. Currently only GoTyme is set.
 */
export interface PaymentChannel {
  /** Full name, shown on the payment card and in Admin. */
  label: string;
  /** Short name used in instructions: "Open your GoTyme app", "via GoTyme". */
  app: string;
  /** Short "pay via" phrase in the order form footnote. */
  via: string;
  /** Longer phrase for the page description and marketing copy ("Pay via ..."). */
  payVia: string;
  /** Optional aside after the app name on the payment page, e.g. which other apps work. */
  scanHint?: string;
  accent: string;
  hint?: string;
  /** Screenshot under "Where do I find the reference number?", served from /public. */
  referenceImage?: string;
}

export const PAYMENT_CHANNELS: Record<PaymentMethod, PaymentChannel> = {
  gotyme: {
    label: "GoTyme Bank",
    app: "GoTyme",
    via: "GoTyme (InstaPay QR)",
    payVia: "GoTyme Bank (InstaPay QR)",
    scanHint: "or any bank app with InstaPay QR",
    accent: "text-teal-600",
    hint: "InstaPay QR. Scan with GoTyme or any bank / e-wallet app that supports InstaPay QR.",
    referenceImage: "/help/gotyme-reference.png",
  },
  gcash: { label: "GCash", app: "GCash", via: "GCash", payVia: "GCash", accent: "text-sky-700" },
  maya: { label: "Maya", app: "Maya", via: "Maya", payVia: "Maya", accent: "text-emerald-700" },
  cash: { label: "Cash", app: "Cash", via: "cash", payVia: "cash", accent: "text-zinc-700" },
};

/** Online channels in the order the payment page lists them. */
export const ONLINE_CHANNELS = ["gotyme", "gcash", "maya"] as const satisfies readonly OnlinePaymentMethod[];

type ChannelFields = Partial<Pick<EventRow, "gotyme_qr_url" | "gcash_qr_url" | "maya_qr_url">>;

/**
 * The channel buyer-facing copy names ("Open your GoTyme app", "via GoTyme"): the
 * first one with a QR code uploaded in Admin > Settings. Nothing to keep in sync,
 * the wording follows whichever QR the organizer put up.
 */
export function primaryChannelKey(event: ChannelFields | null | undefined): OnlinePaymentMethod {
  return ONLINE_CHANNELS.find((k) => event?.[`${k}_qr_url`]) ?? "gotyme";
}

/** The first channel added in Settings that buyers can use, when no built-in one has a QR. */
const firstExtra = (event: ChannelFields | null | undefined, extras: readonly ExtraChannel[]) =>
  ONLINE_CHANNELS.some((k) => event?.[`${k}_qr_url`]) ? undefined : extras.find((c) => c.enabled && (c.qrUrl || c.accountNumber));

/**
 * The primary channel's display details: the first built-in channel with a QR, or
 * else the first channel added in Settings (pass `extras` for that), or GoTyme.
 */
export const primaryChannel = (
  event: ChannelFields | null | undefined,
  channels: Record<PaymentMethod, PaymentChannel> = PAYMENT_CHANNELS,
  extras: readonly ExtraChannel[] = [],
): PaymentChannel => {
  const x = firstExtra(event, extras);
  return x ? { label: x.label, app: x.app, via: x.via, payVia: x.payVia, hint: x.hint || undefined, referenceImage: x.referenceImage ?? undefined, accent: "text-cyan-300" } : channels[primaryChannelKey(event)];
};

/** Account holder name shown beside the primary channel's QR (events row, or the extra channel). */
export function primaryAccountName(event: ChannelFields & Pick<EventRow, "gotyme_account_name" | "gcash_account_name" | "maya_account_name">, extras: readonly ExtraChannel[] = []): string | null {
  const x = firstExtra(event, extras);
  return x ? x.accountName || null : event[`${primaryChannelKey(event)}_account_name`] ?? null;
}

import type { ExtraChannel } from "@/lib/rules-types";
import type { EventRow, OnlinePaymentMethod, PaymentMethod } from "@/lib/supabase/types";
