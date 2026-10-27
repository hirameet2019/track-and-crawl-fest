import { ONLINE_CHANNELS } from "@/config/event";
import type { Rules } from "@/lib/rules-types";
import type { EventRow, OnlinePaymentMethod, OrderPaymentMethod } from "@/lib/supabase/types";

/** One way to pay, as the payment page offers it and as an order records it. */
export interface PaymentOption {
  /** "gotyme" / "gcash" / "maya", or a channel id from Settings. Stored as orders.payment_channel. */
  id: string;
  /** What orders.payment_method records: the built-in key, or "other". */
  method: Exclude<OrderPaymentMethod, "cash">;
  label: string;
  app: string;
  via: string;
  payVia: string;
  scanHint?: string;
  hint?: string;
  referenceImage?: string;
  accent: string;
  qr: string | null;
  accountName: string | null;
  accountNumber: string | null;
}

type EventPay = Pick<EventRow, "gotyme_qr_url" | "gotyme_account_name" | "gcash_qr_url" | "gcash_account_name" | "maya_qr_url" | "maya_account_name">;

/**
 * Every channel a buyer can pay with right now, in page order: the built-in ones
 * with a QR on the events row, then the channels added in Settings that are
 * switched on and have a QR or an account number.
 */
export function paymentOptions(event: EventPay, rules: Pick<Rules, "channels" | "extraChannels">): PaymentOption[] {
  const builtIn = ONLINE_CHANNELS.filter((k) => event[`${k}_qr_url`]).map(
    (k: OnlinePaymentMethod): PaymentOption => ({
      ...rules.channels[k],
      id: k,
      method: k,
      qr: event[`${k}_qr_url`],
      accountName: event[`${k}_account_name`] ?? null,
      accountNumber: null,
    }),
  );
  const extras = rules.extraChannels
    .filter((c) => c.enabled && (c.qrUrl || c.accountNumber))
    .map(
      (c): PaymentOption => ({
        id: c.id,
        method: "other",
        label: c.label,
        app: c.app,
        via: c.via,
        payVia: c.payVia,
        hint: c.hint || undefined,
        referenceImage: c.referenceImage ?? undefined,
        accent: "text-cyan-300",
        qr: c.qrUrl,
        accountName: c.accountName || null,
        accountNumber: c.accountNumber || null,
      }),
    );
  return [...builtIn, ...extras];
}

/**
 * What the proof form offers and the server accepts: the channels above, or GoTyme
 * alone while nothing is set up yet (the page has always fallen back to it). The
 * payment page and submitPaymentProof both use this, so they never disagree.
 */
export function offeredOptions(event: EventPay, rules: Pick<Rules, "channels" | "extraChannels">): PaymentOption[] {
  const options = paymentOptions(event, rules);
  return options.length ? options : [{ ...rules.channels.gotyme, id: "gotyme", method: "gotyme", qr: null, accountName: null, accountNumber: null }];
}

/**
 * How an order's payment reads on staff screens, receipts and exports: the channel
 * name saved with the proof ("BPI bank transfer"), else the method key as before.
 */
export const paymentLabel = (o: { payment_method: string | null; payment_channel_label?: string | null }): string =>
  o.payment_channel_label || (o.payment_method ? o.payment_method.toUpperCase() : "-");
