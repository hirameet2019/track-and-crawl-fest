import type { Attendee } from "@/lib/supabase/types";

/**
 * Name of the vehicle ticket in an order (e.g. "Car Registration"), for labels that
 * refer to the car a companion rides with. Undefined for an order with no car.
 */
export function carNameOf(items: { ticket_type: { name: string; requires_vehicle?: boolean } }[]): string | undefined {
  return items.find((i) => i.ticket_type.requires_vehicle)?.ticket_type.name;
}

/**
 * "Passenger x 1 (included with Car Registration)" style label for an order
 * line. `carName` names the car that paid companions ride with; pass carNameOf(items)
 * so the wording follows the event's own ticket names rather than this one's.
 */
export function itemLabel(
  it: { qty: number; unit_price_centavos: number; attendees: Attendee[] | null; ticket_type: { name: string } },
  withQty = true,
  carName?: string,
): string {
  const atts = it.attendees ?? [];
  const included = atts.filter((a) => a.included).length;
  const companions = atts.filter((a) => a.companion_of && !a.included).length;
  const base = withQty ? `${it.ticket_type.name} x ${it.qty}` : it.ticket_type.name;
  // The free passenger rides on the car's own number, so the type name alone would
  // read as a second car; name the line for what it is.
  if (included > 0 && included === it.qty) {
    const what = `Passenger${withQty ? ` x ${it.qty}` : ""}`;
    return `${what} (included with ${it.ticket_type.name})`;
  }
  if (companions > 0) return `${base} (incl. ${companions} companion${companions === 1 ? "" : "s"} of ${carName ?? "the car"})`;
  return base;
}
