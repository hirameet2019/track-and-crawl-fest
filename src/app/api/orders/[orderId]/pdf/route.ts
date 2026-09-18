import { NextResponse } from "next/server";
import { getOrderBundle } from "@/lib/queries";
import { buildOrderPdf } from "@/lib/pdf/ticket-pdf";

export const dynamic = "force-dynamic";

/**
 * Download the receipt + tickets PDF. The order UUID is unguessable and is only
 * known to the buyer (email/status page) and staff, so no extra auth is applied.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await ctx.params;
  const bundle = await getOrderBundle(orderId);
  if (!bundle) return new NextResponse("Not found", { status: 404 });
  if (bundle.order.status !== "paid") return new NextResponse("Order not paid", { status: 409 });

  const pdf = await buildOrderPdf(bundle);
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="tickets-order-${bundle.order.order_no}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
