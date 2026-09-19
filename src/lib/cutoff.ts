import type { TicketTypeRow } from "@/lib/supabase/types";

/**
 * Per-ticket-type online sales cut-off. Pure functions, safe in client
 * components. All display is in Manila time because that is where the buyers
 * and the organizer are.
 */

export function isTypeClosed(t: Pick<TicketTypeRow, "sales_close_at">, now: Date = new Date()): boolean {
  return !!t.sales_close_at && new Date(t.sales_close_at).getTime() <= now.getTime();
}

/** "Oct 4, 11:59 PM" in Manila time. */
export function fmtCutoff(iso: string, opts: { withTime?: boolean } = {}): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric" });
  if (opts.withTime === false) return date;
  const time = d.toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" });
  return `${date}, ${time}`;
}

/** Hours until the cut-off; negative when already closed, null when there is none. */
export function hoursUntilCutoff(t: Pick<TicketTypeRow, "sales_close_at">, now: Date = new Date()): number | null {
  if (!t.sales_close_at) return null;
  return (new Date(t.sales_close_at).getTime() - now.getTime()) / 3600000;
}

/** "YYYY-MM-DDTHH:mm" in Manila time, for a <input type="datetime-local">. */
export function toManilaLocalInput(iso: string | null): string {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(iso));
  const g = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour") === "24" ? "00" : g("hour")}:${g("minute")}`;
}

/** Interpret a datetime-local value as Manila time (UTC+8), independent of the admin's device timezone. */
export function fromManilaLocalInput(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:59+08:00`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
