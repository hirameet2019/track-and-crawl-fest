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
  "order.converted": { cat: "payments", label: "Order converted" },
  "order.balance_settled": { cat: "payments", label: "Balance settled" },
  "ticket.kit": { cat: "tickets", label: "Kit item handed over" },
  "walkin.recorded": { cat: "walkin", label: "Walk-in tally" },
  "ticket_type.walkin_price": { cat: "walkin", label: "Gate price changed" },
  "drifter.bands": { cat: "walkin", label: "Drifter wristbands" },
  "ticket_type.free_allowance": { cat: "walkin", label: "Free bands per drifter changed" },
  "drifter.entry_added": { cat: "walkin", label: "Drifters added to the entry list" },
  "drifter.entry_removed": { cat: "walkin", label: "Drifter removed from the entry list" },
  "drifter.registered": { cat: "walkin", label: "Drifter sent in their list" },
  "drifter.self_registered": { cat: "walkin", label: "Drifter signed up through the shared link" },
  "drifter.signup_link": { cat: "walkin", label: "Drifter sign-up link changed" },
  "drifter.handed_over": { cat: "walkin", label: "Pre-registered bands handed over" },
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
      return `${qty > 0 ? "+" : ""}${qty} band(s) · ${peso(d.unit_price_centavos)} each · ${String(d.method ?? "cash").toUpperCase()}`;
    }
    case "ticket_type.walkin_price":
      return `New gate price ${peso(d.walkin_price_centavos)}`;
    case "drifter.bands": {
      const qty = Number(d.qty ?? 0);
      const paid = Number(d.paid ?? 0);
      return [
        `${d.drifter ?? "?"}${d.team ? ` (${d.team})` : ""}: ${qty > 0 ? "+" : ""}${qty} band(s)`,
        Number(d.free ?? 0) ? `${d.free} free` : "",
        paid ? `${paid} paid at ${peso(d.unit_price_centavos)} (${String(d.method ?? "cash").toUpperCase()}${d.payment_ref ? ` ref ${d.payment_ref}` : ""}${d.payment_confirmed ? ", payment confirmed" : ""})` : "",
        qty > 0 ? (d.rules_ack ? "rules confirmed" : "RULES NOT CONFIRMED") : "",
      ].filter(Boolean).join(" · ");
    }
    case "drifter.entry_added":
      return `${d.count} drifter(s)${Array.isArray(d.names) ? `: ${(d.names as string[]).slice(0, 6).join(", ")}${(d.names as string[]).length > 6 ? "..." : ""}` : ""}`;
    case "drifter.entry_removed":
      return `${d.drifter ?? "?"} - link closed`;
    case "drifter.registered":
      return `${d.drifter ?? "?"}${d.team ? ` (${d.team})` : ""} listed ${d.bands} band(s)${d.resubmitted ? " (updated)" : ""} and confirmed the rules`;
    case "drifter.self_registered":
      return `${d.drifter ?? "?"}${d.team ? ` (${d.team})` : ""}${d.car ? ` · car #${d.car}` : ""} signed up with ${d.bands} band(s)`;
    case "drifter.signup_link":
      return d.action === "close" ? "Sign-up link closed" : d.action === "replace" ? "Sign-up link replaced; the old one stopped working" : "Sign-up link opened";
    case "drifter.handed_over": {
      const charge = Number(d.charge_centavos ?? 0);
      return `${d.drifter ?? "?"}${d.team ? ` (${d.team})` : ""}: ${d.bands} band(s) handed over${charge ? ` - ${peso(charge)} received ${String(d.method ?? "cash").toUpperCase()}${d.payment_ref ? ` ref ${d.payment_ref}` : ""}` : " - all free"}`;
    }
    case "ticket_type.free_allowance":
      return `${d.free_allowance} free band(s) per drifter`;
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
