import type { OrderStatus, TicketStatus } from "@/lib/supabase/types";

const ORDER: Record<OrderStatus, { label: string; cls: string }> = {
  pending_payment: { label: "Awaiting payment", cls: "bg-amber-100 text-amber-800" },
  awaiting_verification: { label: "For verification", cls: "bg-blue-100 text-blue-800" },
  paid: { label: "Paid", cls: "bg-emerald-100 text-emerald-800" },
  rejected: { label: "Rejected", cls: "bg-red-100 text-red-800" },
  expired: { label: "Expired", cls: "bg-zinc-200 text-zinc-700" },
  cancelled: { label: "Cancelled", cls: "bg-zinc-200 text-zinc-700" },
};

const TICKET: Record<TicketStatus, { label: string; cls: string }> = {
  issued: { label: "Issued", cls: "bg-emerald-100 text-emerald-800" },
  redeemed: { label: "Redeemed", cls: "bg-zinc-800 text-white" },
  void: { label: "Void", cls: "bg-red-100 text-red-800" },
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const s = ORDER[status];
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.cls}`}>{s.label}</span>;
}

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  const s = TICKET[status];
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.cls}`}>{s.label}</span>;
}
