import { LOCALE } from "@/config/site";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Everything staff (or the system on a buyer's behalf) does that changes money,
 * tickets or access lands in audit_log. `actor` is the staff auth id, or null
 * for buyer/system actions.
 */
export interface AuditEntry {
  actor: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  data?: Record<string, unknown> | null;
}

export async function audit(admin: SupabaseClient, e: AuditEntry): Promise<void> {
  const { error } = await admin.from("audit_log").insert({ actor: e.actor, action: e.action, entity: e.entity, entity_id: e.entity_id, data: e.data ?? null });
  if (error) console.error("[audit] insert failed:", error.message, e.action);
}

export type AuditCategory = "orders" | "payments" | "tickets" | "walkin" | "numbers" | "staff" | "settings" | "other";

export const CATEGORY_LABEL: Record<AuditCategory, string> = {
  orders: "Orders",
  payments: "Payments",
  tickets: "Gate / tickets",
  walkin: "Walk-in tally",
  numbers: "Number pool",
  staff: "Staff access",
  settings: "Settings",
  other: "Other",
};

/** Action → category and short human label. Unknown actions fall back to "other". */
const ACTIONS: Record<string, { cat: AuditCategory; label: string }> = {
  "order.created": { cat: "orders", label: "Order placed" },
  "order.proof_submitted": { cat: "payments", label: "Payment proof submitted" },
  "order.issued": { cat: "payments", label: "Payment approved, tickets issued" },
  "order.rejected": { cat: "payments", label: "Payment rejected" },
  "order.cancelled": { cat: "orders", label: "Unpaid order cancelled" },
  "order.resent": { cat: "orders", label: "Tickets re-sent by email" },
  "order.reverted": { cat: "orders", label: "Paid order reverted, number released" },
  "ticket.redeemed": { cat: "tickets", label: "Ticket scanned at gate" },
  "ticket.unredeemed": { cat: "tickets", label: "Gate scan undone, ticket usable again" },
  "ticket.voided": { cat: "payments", label: "Ticket voided" },
  "ticket.unvoided": { cat: "payments", label: "Voided ticket restored" },
  "order.voided": { cat: "payments", label: "Paid order voided" },
  "order.converted": { cat: "payments", label: "Order converted" },
  "order.balance_settled": { cat: "payments", label: "Balance settled" },
  "ticket.kit": { cat: "tickets", label: "Kit item handed over" },
  "walkin.recorded": { cat: "walkin", label: "Walk-in tally" },
  "ticket_type.walkin_price": { cat: "walkin", label: "Gate price changed" },
  "numbers.imported": { cat: "numbers", label: "Number range imported" },
  "numbers.imported_list": { cat: "numbers", label: "Number list imported" },
  "number.voided": { cat: "numbers", label: "Number voided" },
  "number.unvoided": { cat: "numbers", label: "Number restored to pool" },
  "number.deleted": { cat: "numbers", label: "Number removed from the pool" },
  "staff.signed_in": { cat: "staff", label: "Staff signed in" },
  "staff.signed_out": { cat: "staff", label: "Staff signed out" },
  "staff.created": { cat: "staff", label: "Staff account added" },
  "staff.updated": { cat: "staff", label: "Staff account changed" },
  "staff.password_set": { cat: "staff", label: "Staff password reset" },
  "role.created": { cat: "staff", label: "Role added" },
  "role.updated": { cat: "staff", label: "Role changed" },
  "role.deleted": { cat: "staff", label: "Role deleted" },
  "settings.email_updated": { cat: "settings", label: "Email settings changed" },
  "ticket_type.cutoff": { cat: "settings", label: "Sales cut-off changed" },
  "settings.site_updated": { cat: "settings", label: "Site look changed" },
  "settings.site_reset": { cat: "settings", label: "Site look reset to defaults" },
  "settings.rules_updated": { cat: "settings", label: "Ordering / payment rules changed" },
  "event.updated": { cat: "settings", label: "Event details changed" },
  "ticket_type.created": { cat: "settings", label: "Ticket type added" },
  "ticket_type.updated": { cat: "settings", label: "Ticket type changed" },
};

export const ALL_ACTIONS = Object.keys(ACTIONS);

export function actionMeta(action: string): { cat: AuditCategory; label: string } {
  return ACTIONS[action] ?? { cat: "other", label: action };
}

export function actionsInCategory(cat: AuditCategory): string[] {
  return ALL_ACTIONS.filter((a) => ACTIONS[a].cat === cat);
}

const peso = (c: unknown) => (typeof c === "number" ? `${LOCALE.currencyCode} ${(c / 100).toLocaleString(LOCALE.locale, { minimumFractionDigits: 2 })}` : "");

/** One-line, plain-English summary of an entry's data payload. */
export function describe(action: string, data: Record<string, unknown> | null | undefined): string {
  const d = data ?? {};
  switch (action) {
    case "order.created":
      return [d.buyer ? `Buyer ${d.buyer}` : "", typeof d.total_centavos === "number" ? peso(d.total_centavos) : "", d.items ? `${d.items} ticket(s)` : ""].filter(Boolean).join(" · ");
    case "order.proof_submitted":
      return [d.method ? String(d.method).toUpperCase() : "", d.reference ? `ref ${d.reference}` : ""].filter(Boolean).join(" ");
    case "order.rejected":
      return d.reason ? `Reason: ${d.reason}` : "";
    case "ticket.voided":
      return [d.number ? String(d.number) : "", d.reason ? `Reason: ${d.reason}` : "", d.order_voided ? "whole order now void" : ""].filter(Boolean).join(" · ");
    case "ticket.unvoided":
      return d.number ? String(d.number) : "";
    case "ticket.unredeemed":
      return [
        d.number ? String(d.number) : "",
        d.was_redeemed_at ? `was scanned ${new Date(String(d.was_redeemed_at)).toLocaleString(LOCALE.locale, { timeZone: LOCALE.timeZone, dateStyle: "medium", timeStyle: "short" })}` : "",
        d.reason ? `Reason: ${d.reason}` : "",
      ].filter(Boolean).join(" · ");
    case "order.voided":
      return [d.order_no ? `Order #${d.order_no}` : "", d.tickets !== undefined ? `${d.tickets} ticket(s)` : "", d.reason ? `Reason: ${d.reason}` : ""].filter(Boolean).join(" · ");
    case "order.converted": {
      const was = Array.isArray(d.from) ? (d.from as { number?: string }[]).map((t) => t.number).filter(Boolean).join(", ") : "";
      const bal = Number(d.balance_centavos ?? 0);
      return [
        d.order_no ? `Order #${d.order_no}` : "",
        was ? `was ${was}` : "",
        `now ${d.to_qty} x ${d.to_type}`,
        `${peso(d.old_total_centavos)} to ${peso(d.new_total_centavos)}`,
        bal > 0 ? `refund ${peso(bal)}` : bal < 0 ? `collect ${peso(-bal)}` : "no difference",
        d.reason ? `Reason: ${d.reason}` : "",
      ].filter(Boolean).join(" · ");
    }
    case "order.balance_settled": {
      const bal = Number(d.balance_centavos ?? 0);
      return [d.order_no ? `Order #${d.order_no}` : "", bal > 0 ? `refunded ${peso(bal)}` : `collected ${peso(-bal)}`, d.note ? String(d.note) : ""].filter(Boolean).join(" · ");
    }
    case "order.reverted":
      return [d.order_no ? `Order #${d.order_no}` : "", Array.isArray(d.released_numbers) ? `released ${d.released_numbers.join(", ")}` : "", d.reason ? String(d.reason) : ""].filter(Boolean).join(" · ");
    case "walkin.recorded": {
      const qty = Number(d.qty ?? 0);
      return `${qty > 0 ? "+" : ""}${qty} sold · ${peso(d.unit_price_centavos)} each · ${String(d.method ?? "cash").toUpperCase()}`;
    }
    case "ticket_type.walkin_price":
      return `New gate price ${peso(d.walkin_price_centavos)}`;
    case "numbers.imported":
      return `${d.prefix ?? ""}${d.start ?? ""} to ${d.prefix ?? ""}${d.end ?? ""}`;
    case "numbers.imported_list":
      return `${d.count ?? ""} serial(s)`;
    case "number.voided":
      return d.reason ? `Reason: ${d.reason}` : "";
    case "number.unvoided":
      return [d.number ? String(d.number) : "", d.previous_reason ? `was void: ${d.previous_reason}` : ""].filter(Boolean).join(" · ");
    case "number.deleted":
      return [d.number ? String(d.number) : "", d.ticket_type ? String(d.ticket_type) : "", d.reason ? String(d.reason) : ""].filter(Boolean).join(" · ");
    case "ticket.kit":
      return `${d.item ?? "item"} ${d.claimed ? "handed over" : "un-ticked"}`;
    case "staff.signed_in":
    case "staff.signed_out":
      return [d.email, d.role].filter(Boolean).join(" · ");
    case "staff.created":
    case "staff.updated":
    case "staff.password_set":
      return [d.name, d.login, d.role, d.active === false ? "inactive" : ""].filter(Boolean).join(" · ");
    case "role.created":
    case "role.updated":
    case "role.deleted":
      return [d.name, Array.isArray(d.permissions) ? (d.permissions as string[]).join(", ") || "no permissions" : ""].filter(Boolean).join(" · ");
    case "settings.email_updated":
      return d.provider ? `Provider ${d.provider}` : "";
    case "settings.site_updated":
    case "settings.rules_updated":
    case "event.updated":
      return Array.isArray(d.changed) && d.changed.length ? `Changed: ${(d.changed as string[]).join(", ")}` : "No changes";
    case "ticket_type.created":
    case "ticket_type.updated":
      return [d.code ? `${d.code} · ${d.name ?? ""}` : String(d.name ?? ""), Array.isArray(d.changed) && d.changed.length ? `changed ${(d.changed as string[]).join(", ")}` : ""].filter(Boolean).join(" · ");
    case "ticket_type.cutoff":
      return `${d.name ?? "Ticket type"}: ${d.sales_close_at ? `closes ${new Date(String(d.sales_close_at)).toLocaleString(LOCALE.locale, { timeZone: LOCALE.timeZone, dateStyle: "medium", timeStyle: "short" })}` : "open, no cut-off"}`;
    default:
      return Object.keys(d).length ? JSON.stringify(d) : "";
  }
}
