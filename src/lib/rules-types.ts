import {
  EXPIRY_NOTICE_MAX_AGE_HOURS,
  MAX_COMPANIONS_PER_CAR,
  MAX_QTY_PER_TYPE,
  PAYMENT_CHANNELS,
  PAYMENT_WINDOW_MINUTES,
  REMINDER_MINUTES_BEFORE_EXPIRY,
  SHIRT_SIZES,
  SHIRT_SIZE_CHART,
  SHIRT_SIZE_CHART_IMAGE,
  type PaymentChannel,
} from "@/config/event";
import { NOTES, STAFF } from "@/config/site";
import type { PaymentMethod } from "@/lib/supabase/types";

/**
 * Business rules edited in Admin > Settings (Payments, Ordering, Advanced).
 * Plain data with no server imports, so client components can use the type and
 * the defaults; the store itself is src/lib/rules.ts.
 */

export interface ShirtRow {
  size: string;
  width: number;
  length: number;
  sleeve: number;
}

export interface Rules {
  paymentWindowMinutes: number;
  reminderMinutes: number;
  expiryNoticeMaxAgeHours: number;
  maxQtyPerType: number;
  maxCompanionsPerCar: number;
  /** Sizes offered, in this order, with the supplier's measurements in inches. */
  shirtChart: ShirtRow[];
  /** Supplier chart image shown above the table; null hides it. */
  shirtChartImage: string | null;
  /** Wording per payment method. `accent` is styling and stays in code. */
  channels: Record<PaymentMethod, PaymentChannel>;
  staffUsernameDomain: string;
  drifterReferencePrefix: string;
}

export const RULE_DEFAULTS: Rules = {
  paymentWindowMinutes: PAYMENT_WINDOW_MINUTES,
  reminderMinutes: REMINDER_MINUTES_BEFORE_EXPIRY,
  expiryNoticeMaxAgeHours: EXPIRY_NOTICE_MAX_AGE_HOURS,
  maxQtyPerType: MAX_QTY_PER_TYPE,
  maxCompanionsPerCar: MAX_COMPANIONS_PER_CAR,
  shirtChart: SHIRT_SIZES.map((size) => ({ size, ...SHIRT_SIZE_CHART[size] })),
  shirtChartImage: SHIRT_SIZE_CHART_IMAGE.src,
  channels: structuredClone(PAYMENT_CHANNELS),
  staffUsernameDomain: STAFF.usernameDomain,
  drifterReferencePrefix: NOTES.drifterReferencePrefix,
};

/** Staff pickers (walk-in, drifters): every method, short name, cash first. */
export const staffMethods = (channels: Rules["channels"]): { key: PaymentMethod; label: string }[] =>
  (["cash", "gotyme", "gcash", "maya"] as const).map((key) => ({ key, label: channels[key].app }));

/** "Width 20 in · Length 29 in · Sleeve 9.5 in" for a size, or null if it is not offered. */
export function shirtSummary(chart: ShirtRow[], size: string): string | null {
  const m = chart.find((r) => r.size === size);
  return m ? `Width ${m.width} in · Length ${m.length} in · Sleeve ${m.sleeve} in` : null;
}
