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
  numbers: "Wristband pool",
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
  "order.resent": { cat: "orders", label: "Tickets re-sent by email" },
  "order.reverted": { cat: "orders", label: "Paid order reverted, wristband released" },
  "ticket.redeemed": { cat: "tickets", label: "Ticket scanned at gate" },
  "ticket.voided": { cat: "payments", label: "Ticket voided" },
  "ticket.unvoided": { cat: "payments", label: "Voided ticket restored" },
  "order.voided": { cat: "payments", label: "Paid order voided" },
  "ticket.kit": { cat: "tickets", label: "Kit item handed over" },
  "walkin.recorded": { cat: "walkin", label: "Walk-in tally" },
  "ticket_type.walkin_price": { cat: "walkin", label: "Gate price changed" },
  "numbers.imported": { cat: "numbers", label: "Wristband range imported" },
  "numbers.imported_list": { cat: "numbers", label: "Wristband list imported" },
  "number.voided": { cat: "numbers", label: "Wristband voided" },
  "number.unvoided": { cat: "numbers", label: "Wristband restored to pool" },
  "staff.signed_in": { cat: "staff", label: "Staff signed in" },
  "staff.signed_out": { cat: "staff", label: "Staff signed out" },
  "settings.email_updated": { cat: "settings", label: "Email settings changed" },
  "ticket_type.cutoff": { cat: "settings", label: "Sales cut-off changed" },
};

export const ALL_ACTIONS = Object.keys(ACTIONS);

export function actionMeta(action: string): { cat: AuditCategory; label: string } {
  return ACTIONS[action] ?? { cat: "other", label: action };
}

export function actionsInCategory(cat: AuditCategory): string[] {
  return ALL_ACTIONS.filter((a) => ACTIONS[a].cat === cat);
}

const peso = (c: unknown) => (typeof c === "number" ? `PHP ${(c / 100).toLocaleString("en-PH", { minimumFractionDigits: 2 })}` : "");

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
    case "order.voided":
      return [d.order_no ? `Order #${d.order_no}` : "", d.tickets !== undefined ? `${d.tickets} ticket(s)` : "", d.reason ? `Reason: ${d.reason}` : ""].filter(Boolean).join(" · ");
    case "order.reverted":
      return [d.order_no ? `Order #${d.order_no}` : "", Array.isArray(d.released_numbers) ? `released ${d.released_numbers.join(", ")}` : "", d.reason ? String(d.reason) : ""].filter(Boolean).join(" · ");
    case "walkin.recorded": {
      const qty = Number(d.qty ?? 0);
      return `${qty > 0 ? "+" : ""}${qty} band(s) · ${peso(d.unit_price_centavos)} each · ${String(d.method ?? "cash").toUpperCase()}`;
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
    case "ticket.kit":
      return `${d.item ?? "item"} ${d.claimed ? "handed over" : "un-ticked"}`;
    case "staff.signed_in":
    case "staff.signed_out":
      return [d.email, d.role].filter(Boolean).join(" · ");
    case "settings.email_updated":
      return d.provider ? `Provider ${d.provider}` : "";
    case "ticket_type.cutoff":
      return `${d.name ?? "Ticket type"}: ${d.sales_close_at ? `closes ${new Date(String(d.sales_close_at)).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" })}` : "open, no cut-off"}`;
    default:
      return Object.keys(d).length ? JSON.stringify(d) : "";
  }
}
