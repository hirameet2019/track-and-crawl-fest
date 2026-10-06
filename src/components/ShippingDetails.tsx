import { SHIRT_PROCESSING, type Shipping } from "@/lib/shipping";

/**
 * Where an order's shirts ship, for staff screens (Verify, Orders list, order
 * page). `shirts` lists the shirts going out, so the person packing them does
 * not have to read the ticket table. Pure markup; safe in client components.
 */
export function ShippingDetails({ shipping, shirts = [], className = "" }: { shipping: Shipping; shirts?: { holder: string | null; size: string | null }[]; className?: string }) {
  return (
    <div className={`rounded-lg border border-violet-400/30 bg-violet-400/5 p-3 text-sm ${className}`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-violet-300">Shirt ships to (via {shipping.courier})</div>
      <div className="mt-1">
        {shipping.name} · {shipping.mobile}<br />
        {shipping.address}<br />
        {shipping.city}, {shipping.province} {shipping.zip}
      </div>
      {shirts.length > 0 && (
        <div className="mt-2 text-xs text-zinc-300">
          {shirts.length === 1 ? "Shirt" : `${shirts.length} shirts`}: {shirts.map((s) => `${s.size ?? "?"}${s.holder ? ` (${s.holder})` : ""}`).join(", ")}
        </div>
      )}
      <div className="mt-1 text-xs text-zinc-500">Made to order, {SHIRT_PROCESSING} of processing; shipping fee shouldered by the buyer. Do not hand these shirts over at the gate.</div>
    </div>
  );
}
