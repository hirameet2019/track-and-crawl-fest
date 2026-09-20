import type { Attendee } from "@/lib/supabase/types";

/** "Passenger wristband x 1 (included with VIP Car Display)" style label for an order line. */
export function itemLabel(it: { qty: number; unit_price_centavos: number; attendees: Attendee[] | null; ticket_type: { name: string } }, withQty = true): string {
  const atts = it.attendees ?? [];
  const included = atts.filter((a) => a.included).length;
  const companions = atts.filter((a) => a.companion_of && !a.included).length;
  const base = withQty ? `${it.ticket_type.name} x ${it.qty}` : it.ticket_type.name;
  // The free passenger rides on a VIP Car Display wristband, so the type name alone would
  // read as a second car; name the line for what it is.
  if (included > 0 && included === it.qty) {
    const what = `Passenger wristband${withQty ? ` x ${it.qty}` : ""}`;
    return `${what} (included with ${it.ticket_type.name})`;
  }
  if (companions > 0) return `${base} (incl. ${companions} companion${companions === 1 ? "" : "s"} of VIP Car Display)`;
  return base;
}
