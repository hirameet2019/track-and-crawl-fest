import { LOCALE } from "@/config/site";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { getOrderBundle } from "@/lib/queries";
import { primaryChannel } from "@/config/event";
import { getRules } from "@/lib/rules";
import { OrderStatusBadge, TicketStatusBadge } from "@/components/StatusBadge";
import { OrderActions } from "@/components/OrderActions";
import { php } from "@/lib/money";
import { SignedImage } from "@/components/SignedImage";
import { TicketActions } from "@/components/TicketActions";
import { carNameOf, itemLabel } from "@/lib/items";
import { shirtShips } from "@/lib/shipping";
import { ShippingDetails } from "@/components/ShippingDetails";
import { paymentLabel } from "@/lib/payment-options";

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(LOCALE.locale, { timeZone: LOCALE.timeZone }) : "-");

export default async function OrderDetailPage({ params }: { params: Promise<{ orderId: string }> }) {
  const session = await requireStaff("staff");
  const isAdmin = session.staff.role === "admin";
  const { orderId } = await params;
  const b = await getOrderBundle(orderId);
  if (!b) notFound();
  const { event, order, items, tickets } = b;
  const rules = await getRules();

  return (
    <div className="space-y-6">
      <Link prefetch={false} href="/admin/orders" className="text-sm text-zinc-500 hover:underline">&larr; Orders</Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">Order #{order.order_no}</h1>
        <OrderStatusBadge status={order.status} />
        <span className="text-sm text-zinc-500">{order.channel}</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <h2 className="font-semibold">Buyer</h2>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            <div><dt className="text-zinc-500">Name</dt><dd>{order.buyer_name}</dd></div>
            <div><dt className="text-zinc-500">Email</dt><dd>{order.buyer_email ?? "-"}</dd></div>
            <div><dt className="text-zinc-500">Mobile</dt><dd>{order.buyer_mobile ?? "-"}</dd></div>
            <div><dt className="text-zinc-500">Payment</dt><dd className="uppercase">{paymentLabel(order)}</dd></div>
            <div><dt className="text-zinc-500">Reference</dt><dd className="font-mono">{order.payment_reference ?? "-"}</dd></div>
            <div><dt className="text-zinc-500">Receipt no.</dt><dd>{order.receipt_no ?? "-"}</dd></div>
            <div><dt className="text-zinc-500">Created</dt><dd>{fmt(order.created_at)}</dd></div>
            <div><dt className="text-zinc-500">Proof submitted</dt><dd>{fmt(order.proof_submitted_at)}</dd></div>
            <div><dt className="text-zinc-500">Paid / verified</dt><dd>{fmt(order.paid_at)}</dd></div>
            <div><dt className="text-zinc-500">Email sent</dt><dd>{fmt(order.email_sent_at)}</dd></div>
            {order.rejection_reason && <div className="col-span-2"><dt className="text-zinc-500">Rejection reason</dt><dd className="text-red-700">{order.rejection_reason}</dd></div>}
          </dl>
          {order.shipping && (
            <ShippingDetails
              className="mt-4"
              shipping={order.shipping}
              shirts={tickets.filter((t) => t.shirt_size && t.status !== "void" && shirtShips(t.ticket_type, order)).map((t) => ({ holder: t.holder_name, size: t.shirt_size }))}
            />
          )}
          <h2 className="mt-5 font-semibold">Items</h2>
          <ul className="mt-2 divide-y text-sm">
            {items.map((it) => (
              <li key={it.id} className="flex justify-between py-2"><span>{itemLabel(it, true, carNameOf(items))}</span><span>{php(it.qty * it.unit_price_centavos)}</span></li>
            ))}
            <li className="flex justify-between py-2 font-bold"><span>Total</span><span>{php(order.total_centavos)}</span></li>
          </ul>
        </div>
        <div className="card">
          <h2 className="font-semibold">Actions</h2>
          <OrderActions
            orderId={order.id} status={order.status} proofPath={order.payment_proof_path} hasEmail={!!order.buyer_email} isAdmin={isAdmin}
            buyerName={order.buyer_name} totalCentavos={order.total_centavos}
            balanceCentavos={order.balance_centavos} balanceSettledAt={order.balance_settled_at}
            hasRedeemed={tickets.some((t) => t.status === "redeemed")}
            payApp={primaryChannel(event, rules.channels, rules.extraChannels).app}
          />
        </div>
      </div>

      {tickets.length > 0 && (
        <div className="card overflow-x-auto">
          <h2 className="font-semibold">Tickets</h2>
          <table className="mt-2 w-full text-sm">
            <thead className="text-left text-xs uppercase text-zinc-500"><tr><th className="py-1">Number</th><th>Type</th><th>Holder</th><th>Shirt</th><th>Vehicle</th><th>Car photo</th><th>Status</th><th>Redeemed</th><th></th>{isAdmin && <th></th>}</tr></thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id} className="border-t">
                  <td className="py-2 font-bold">{t.number}</td>
                  <td>{t.ticket_type.name}</td>
                  <td>{t.holder_name}</td>
                  <td>{t.shirt_size ?? "-"}{t.shirt_size && shirtShips(t.ticket_type, order) ? <span className="ml-1 rounded bg-violet-400/15 px-1 text-[10px] font-semibold text-violet-200">ships</span> : null}</td>
                  <td>{t.vehicle_plate ? `${t.vehicle_plate} ${t.vehicle_model ?? ""}` : t.companion_of ? <span className="text-emerald-300">Companion of {t.companion_of}</span> : "-"}</td>
                  <td>{t.vehicle_photo_path ? <SignedImage bucket="vehicle-photos" path={t.vehicle_photo_path} alt={`Car ${t.vehicle_plate ?? ""}`} className="h-12 w-16 rounded-md object-cover" /> : "-"}</td>
                  <td><TicketStatusBadge status={t.status} /></td>
                  <td className="text-xs text-zinc-500">{fmt(t.redeemed_at)}</td>
                  <td><Link prefetch={false} href={`/t/${t.qr_token}`} className="text-xs underline" target="_blank">View QR</Link></td>
                  {isAdmin && <td className="py-2">{t.ticket_number_id === null ? <span className="text-xs text-zinc-500">converted</span> : <TicketActions ticketId={t.id} number={t.number} status={t.status} voidReason={t.void_reason} />}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
