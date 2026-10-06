/**
 * Shirts that ship. A label with ships_shirt (VIP Pass) asks online buyers where to
 * send the shirt: it is made to order, takes about two weeks, then goes out by
 * courier with the shipping fee shouldered by the buyer. Pure; safe in client code.
 */

export const COURIERS = ["LBC", "J&T Express"] as const;
export type Courier = (typeof COURIERS)[number];

/** How long a shipped shirt takes before it goes out. */
export const SHIRT_PROCESSING = "about two weeks";

export interface Shipping {
  name: string;
  mobile: string;
  /** House or unit no., street, barangay. */
  address: string;
  city: string;
  province: string;
  zip: string;
  courier: Courier;
}

/** A ticket's shirt ships (instead of being handed over at the event). */
export function shirtShips(type: { ships_shirt?: boolean | null } | null | undefined, order: { shipping?: unknown } | null | undefined): boolean {
  return !!type?.ships_shirt && !!order?.shipping;
}

/** One-line address for lists, exports and the scanner. */
export function shippingOneLine(s: Shipping): string {
  return `${s.name}, ${s.mobile} · ${s.address}, ${s.city}, ${s.province} ${s.zip} · ${s.courier}`;
}

/** What the buyer is told wherever the shipped shirt comes up. */
export const SHIPPING_NOTE =
  `The shirt is made to order: ${SHIRT_PROCESSING} of processing, then it ships by LBC or J&T Express to your address. ` +
  "The shipping fee is shouldered by the buyer and is not included in the ticket total.";
export const SHIPPING_NOTE_TL =
  "Gagawin pa ang shirt: mga dalawang linggo bago ipadala sa LBC o J&T Express. Ang buyer ang magbabayad ng shipping fee; hindi ito kasama sa total.";
