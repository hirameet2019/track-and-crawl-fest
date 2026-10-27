import type { OrderStatus, TicketStatus } from "@/lib/supabase/types";

const ORDER: Record<OrderStatus, { label: string; cls: string }> = {
  pending_payment: { label: "Awaiting payment", cls: "border-amber-400/35 bg-amber-400/12 text-amber-200" },
  awaiting_verification: { label: "For verification", cls: "border-sky-400/35 bg-sky-400/12 text-sky-200" },
  paid: { label: "Paid", cls: "border-emerald-400/35 bg-emerald-400/12 text-emerald-200" },
  rejected: { label: "Rejected", cls: "border-rose-400/40 bg-rose-400/12 text-rose-200" },
  expired: { label: "Expired", cls: "border-white/15 bg-white/[0.06] text-white/75" },
  cancelled: { label: "Cancelled", cls: "border-white/15 bg-white/[0.06] text-white/75" },
  voided: { label: "Voided", cls: "border-rose-400/40 bg-rose-400/12 text-rose-200" },
};

const TICKET: Record<TicketStatus, { label: string; cls: string }> = {
  issued: { label: "Issued", cls: "border-emerald-400/35 bg-emerald-400/12 text-emerald-200" },
  redeemed: { label: "Redeemed", cls: "border-cyan-300/40 bg-cyan-300/12 text-cyan-100" },
  void: { label: "Void", cls: "border-rose-400/40 bg-rose-400/12 text-rose-200" },
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const s = ORDER[status];
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${s.cls}`}><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />{s.label}</span>;
}

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  const s = TICKET[status];
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${s.cls}`}><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />{s.label}</span>;
}
