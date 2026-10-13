/* eslint-disable react-hooks/purity -- server component: rendered once per request */
import { requireStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { VerifyQueue, type QueueOrder } from "@/components/VerifyQueue";
import { LiveOrders } from "@/components/LiveOrders";
import type { Attendee } from "@/lib/supabase/types";
import { primaryChannel } from "@/config/event";
import { getActiveEvent, getTicketTypes } from "@/lib/queries";
import { getRules } from "@/lib/rules";

export default async function VerifyPage() {
  await requireStaff("staff");
  const [event, rules] = await Promise.all([getActiveEvent(), getRules()]);
  // Orders holding only labels hidden in Settings (hidden_in_admin) are left out; an
  // order that also holds a shown label stays, in full, since its whole payment is checked.
  const hidden = new Set(event ? (await getTicketTypes(event.id)).filter((t) => t.hidden_in_admin).map((t) => t.id) : []);
  const admin = createAdminClient();
  const { data } = await admin
    .from("orders")
    .select("id, order_no, buyer_name, buyer_email, buyer_mobile, total_centavos, payment_method, payment_reference, payment_proof_path, proof_submitted_at, shipping, order_items(qty, attendees, ticket_type_id, ticket_type:ticket_types(name, requires_vehicle, ships_shirt))")
    .eq("status", "awaiting_verification")
    .order("proof_submitted_at", { ascending: true });

  const now = Date.now();
  const shown = (data ?? []).filter((o) => {
    const lines = o.order_items as unknown as { ticket_type_id: string }[];
    return lines.length === 0 || lines.some((l) => !hidden.has(l.ticket_type_id));
  });
  const orders = shown.map((o) => ({
    ...o,
    age_min: o.proof_submitted_at ? Math.round((now - new Date(o.proof_submitted_at).getTime()) / 60000) : null,
    order_items: (o.order_items as unknown as { qty: number; attendees: Attendee[] | null; ticket_type: { name: string; requires_vehicle: boolean; ships_shirt: boolean } | null }[]).map((i) => ({
      qty: i.qty,
      name: i.ticket_type?.name ?? "",
      requires_vehicle: i.ticket_type?.requires_vehicle ?? false,
      ships_shirt: i.ticket_type?.ships_shirt ?? false,
      attendees: i.attendees ?? [],
    })),
  })) as QueueOrder[];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Payment verification</h1>
        <LiveOrders watch="verification" />
      </div>
      <p className="text-sm text-zinc-500">Compare each screenshot and reference number with the organizer&apos;s {primaryChannel(event, rules.channels).app} transaction history, then approve or reject. New proofs appear here on their own; no need to refresh.</p>
      <div className="mt-6">
        <VerifyQueue orders={orders} />
      </div>
    </div>
  );
}
