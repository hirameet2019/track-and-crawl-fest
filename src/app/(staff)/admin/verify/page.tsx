/* eslint-disable react-hooks/purity -- server component: rendered once per request */
import { requireStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { VerifyQueue, type QueueOrder } from "@/components/VerifyQueue";
import type { Attendee } from "@/lib/supabase/types";

export default async function VerifyPage() {
  await requireStaff("staff");
  const admin = createAdminClient();
  const { data } = await admin
    .from("orders")
    .select("id, order_no, buyer_name, buyer_email, buyer_mobile, total_centavos, payment_method, payment_reference, payment_proof_path, proof_submitted_at, order_items(qty, attendees, ticket_type:ticket_types(name, requires_vehicle))")
    .eq("status", "awaiting_verification")
    .order("proof_submitted_at", { ascending: true });

  const now = Date.now();
  const orders = (data ?? []).map((o) => ({
    ...o,
    age_min: o.proof_submitted_at ? Math.round((now - new Date(o.proof_submitted_at).getTime()) / 60000) : null,
    order_items: (o.order_items as unknown as { qty: number; attendees: Attendee[] | null; ticket_type: { name: string; requires_vehicle: boolean } | null }[]).map((i) => ({
      qty: i.qty,
      name: i.ticket_type?.name ?? "",
      requires_vehicle: i.ticket_type?.requires_vehicle ?? false,
      attendees: i.attendees ?? [],
    })),
  })) as QueueOrder[];

  return (
    <div>
      <h1 className="text-2xl font-bold">Payment verification</h1>
      <p className="text-sm text-zinc-500">Compare each screenshot and reference number with the organizer&apos;s GoTyme transaction history, then approve or reject.</p>
      <div className="mt-6">
        <VerifyQueue orders={orders} />
      </div>
    </div>
  );
}
