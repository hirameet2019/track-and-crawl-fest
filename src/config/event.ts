/**
 * Static, non-sensitive presentation settings.
 * Event details, organizer receipt details, prices and ticket types live in the
 * database (see supabase/seed.sql) so they can be edited without a redeploy.
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "http://localhost:3000";

/** Minutes a buyer has to pay and upload proof before the order expires. */
export const PAYMENT_WINDOW_MINUTES = 30;

/** Shirt sizes offered on ticket types that include a shirt. PLACEHOLDER: confirm with organizer. */
export const SHIRT_SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL"] as const;
export type ShirtSize = (typeof SHIRT_SIZES)[number];

/** Maximum tickets per online order. */
export const MAX_QTY_PER_TYPE = 10;
