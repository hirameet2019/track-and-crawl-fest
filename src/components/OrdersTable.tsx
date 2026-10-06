"use client";

import { LOCALE } from "@/config/site";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getOrderDetail, type OrderDetail } from "@/app/actions/admin";
import { OrderStatusBadge, TicketStatusBadge } from "@/components/StatusBadge";
import { OrderActions } from "@/components/OrderActions";
import { TicketActions } from "@/components/TicketActions";
import { SignedImage } from "@/components/SignedImage";
import { php } from "@/lib/money";
import { ShippingDetails } from "@/components/ShippingDetails";
import type { OrderStatus } from "@/lib/supabase/types";

export interface OrderRow {
  id: string;
  order_no: number;
  buyer_name: string;
  buyer_email: string | null;
  buyer_mobile: string | null;
  total_centavos: number;
  status: OrderStatus;
  channel: string;
  payment_method: string | null;
  payment_reference: string | null;
  created_at: string;
}

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(LOCALE.locale, { timeZone: LOCALE.timeZone }) : "-");
const COLS = 7;

/**
 * Orders list where a row opens in place instead of navigating away. The detail is
 * fetched the first time a row is opened and re-fetched only when that order's status
 * changes (an approval, rejection or void), so browsing the list costs one query.
 */
export function OrdersTable({ rows, isAdmin, payApp }: { rows: OrderRow[]; isAdmin: boolean; payApp: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  // detail plus the status it was loaded at, so a live update can invalidate it
  const [cache, setCache] = useState<Record<string, { at: OrderStatus; detail: OrderDetail | null }>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const loadingRef = useRef<string | null>(null);

  const load = useCallback((id: string) => {
    if (loadingRef.current === id) return;
    loadingRef.current = id;
    setLoading(id);
    const status = rows.find((r) => r.id === id)?.status;
    getOrderDetail(id)
      .then((detail) => {
        if (status) setCache((c) => ({ ...c, [id]: { at: status, detail } }));
      })
      .finally(() => {
        loadingRef.current = null;
        setLoading((l) => (l === id ? null : l));
      });
  }, [rows]);

  // Re-fetch the open row when a live update changed its status.
  useEffect(() => {
    if (!openId) return;
    const row = rows.find((r) => r.id === openId);
    const cached = cache[openId];
    if (row && cached && cached.at !== row.status) load(openId);
  }, [openId, rows, cache, load]);

  const toggle = (id: string) => {
    const next = openId === id ? null : id;
    setOpenId(next);
    if (next && !cache[next]) load(next);
  };

  return (
    <div className="card mt-4 overflow-x-auto p-0">
      <table className="w-full text-sm [&_tbody_td]:px-3 [&_th]:px-3">
        <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500">
          <tr>
            <th className="py-3">Order</th><th>Buyer</th><th>Channel</th><th>Payment</th>
            <th className="text-right">Total</th><th>Status</th><th>Created</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => {
            const open = openId === o.id;
            const entry = cache[o.id];
            return (
              <Fragment key={o.id}>
                  <tr
                    className={`cursor-pointer border-t hover:bg-white/5 ${open ? "bg-white/5" : ""}`}
                    onClick={() => toggle(o.id)}
                  >
                    <td className="py-3">
                      <button
                        type="button"
                        className="flex items-center gap-1.5 font-semibold"
                        aria-expanded={open}
                        aria-controls={`order-panel-${o.id}`}
                        onClick={(e) => { e.stopPropagation(); toggle(o.id); }}
                      >
                        <span aria-hidden className={`inline-block text-[10px] text-zinc-400 transition-transform ${open ? "rotate-90" : ""}`}>&#9654;</span>
                        #{o.order_no}
                      </button>
                    </td>
                    <td><div>{o.buyer_name}</div><div className="text-xs text-zinc-500">{o.buyer_email} {o.buyer_mobile}</div></td>
                    <td className="text-zinc-600">{o.channel}</td>
                    <td className="text-xs"><span className="uppercase">{o.payment_method}</span> <span className="font-mono text-zinc-500">{o.payment_reference}</span></td>
                    <td className="text-right">{php(o.total_centavos)}</td>
                    <td><OrderStatusBadge status={o.status} /></td>
                    <td className="text-xs text-zinc-500">{new Date(o.created_at).toLocaleString(LOCALE.locale, { timeZone: LOCALE.timeZone })}</td>
                  </tr>
                  {open && (
                    <tr className="border-t border-white/10 bg-black/20">
                      <td colSpan={COLS} className="!px-0">
                        <div id={`order-panel-${o.id}`} className="p-4">
                          {loading === o.id && !entry ? (
                            <div className="py-6 text-center text-sm text-zinc-500">Loading order #{o.order_no}...</div>
                          ) : entry?.detail ? (
                            <OrderPanel d={entry.detail} isAdmin={isAdmin} payApp={payApp} />
                          ) : (
                            <div className="py-6 text-center text-sm text-zinc-500">Could not load this order.</div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
              </Fragment>
            );
          })}
          {rows.length === 0 && <tr><td colSpan={COLS} className="p-6 text-center text-zinc-500">No orders match.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function OrderPanel({ d, isAdmin, payApp }: { d: OrderDetail; isAdmin: boolean; payApp: string }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Order #{d.order_no} details</h3>
          <Link prefetch={false} href={`/admin/orders/${d.id}`} className="text-xs text-cyan-300 hover:underline">Open full page &#8599;</Link>
        </div>
        <dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
          <div><dt className="text-zinc-500">Name</dt><dd>{d.buyer_name}</dd></div>
          <div><dt className="text-zinc-500">Email</dt><dd className="break-all">{d.buyer_email ?? "-"}</dd></div>
          <div><dt className="text-zinc-500">Mobile</dt><dd>{d.buyer_mobile ?? "-"}</dd></div>
          <div><dt className="text-zinc-500">Payment</dt><dd className="uppercase">{d.payment_method ?? "-"}</dd></div>
          <div><dt className="text-zinc-500">Reference</dt><dd className="font-mono">{d.payment_reference ?? "-"}</dd></div>
          <div><dt className="text-zinc-500">Receipt no.</dt><dd>{d.receipt_no ?? "-"}</dd></div>
          <div><dt className="text-zinc-500">Created</dt><dd>{fmt(d.created_at)}</dd></div>
          <div><dt className="text-zinc-500">Proof submitted</dt><dd>{fmt(d.proof_submitted_at)}</dd></div>
          <div><dt className="text-zinc-500">Paid / verified</dt><dd>{fmt(d.paid_at)}</dd></div>
          <div><dt className="text-zinc-500">Email sent</dt><dd>{fmt(d.email_sent_at)}</dd></div>
          {d.rejection_reason && <div className="col-span-2 sm:col-span-3"><dt className="text-zinc-500">Rejection reason</dt><dd className="text-red-400">{d.rejection_reason}</dd></div>}
        </dl>

        <h4 className="mt-4 font-semibold">Items</h4>
        <ul className="mt-1 divide-y divide-white/10 text-sm">
          {d.items.map((it) => (
            <li key={it.id} className="flex justify-between gap-3 py-2"><span>{it.label}</span><span className="shrink-0 tabular-nums">{php(it.amount_centavos)}</span></li>
          ))}
          <li className="flex justify-between py-2 font-bold"><span>Total</span><span className="tabular-nums">{php(d.total_centavos)}</span></li>
        </ul>
        {d.shipping && (
          <ShippingDetails
            className="mt-3"
            shipping={d.shipping}
            shirts={d.tickets.filter((t) => t.ships && t.status !== "void").map((t) => ({ holder: t.holder_name, size: t.shirt_size }))}
          />
        )}
      </div>

      <div className="space-y-3">
        <div>
          <h4 className="font-semibold">Actions</h4>
          <OrderActions
            orderId={d.id} status={d.status} proofPath={d.payment_proof_path} hasEmail={!!d.buyer_email} isAdmin={isAdmin}
            buyerName={d.buyer_name} totalCentavos={d.total_centavos}
            balanceCentavos={d.balance_centavos} balanceSettledAt={d.balance_settled_at}
            hasRedeemed={d.tickets.some((t) => t.status === "redeemed")}
            payApp={payApp}
          />
        </div>
        {d.payment_proof_path && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Payment screenshot</h4>
            <SignedImage bucket="payment-proofs" path={d.payment_proof_path} alt={`Payment proof for order ${d.order_no}`} className="mt-1 max-h-64 w-full rounded-lg object-contain" />
          </div>
        )}
      </div>

      {d.tickets.length > 0 && (
        <div className="lg:col-span-3 overflow-x-auto">
          <h4 className="font-semibold">Tickets</h4>
          <table className="mt-1 w-full text-sm">
            <thead className="text-left text-xs uppercase text-zinc-500">
              <tr><th className="py-1">Number</th><th>Type</th><th>Holder</th><th>Shirt</th><th>Vehicle</th><th>Car photo</th><th>Status</th><th>Redeemed</th><th></th>{isAdmin && <th></th>}</tr>
            </thead>
            <tbody>
              {d.tickets.map((t) => (
                <tr key={t.id} className="border-t border-white/10">
                  <td className="py-2 font-bold">{t.number}</td>
                  <td>{t.type}</td>
                  <td>{t.holder_name}</td>
                  <td>{t.shirt_size ?? "-"}{t.ships ? <span className="ml-1 rounded bg-violet-400/15 px-1 text-[10px] font-semibold text-violet-200">ships</span> : null}</td>
                  <td>{t.vehicle ?? (t.companion_of ? <span className="text-emerald-300">{t.included ? "Passenger" : "Companion"} of {t.companion_of}</span> : "-")}</td>
                  <td>{t.vehicle_photo_path ? <SignedImage bucket="vehicle-photos" path={t.vehicle_photo_path} alt={`Car ${t.vehicle ?? ""}`} className="h-12 w-16 rounded-md object-cover" /> : "-"}</td>
                  <td><TicketStatusBadge status={t.status} /></td>
                  <td className="text-xs text-zinc-500">{fmt(t.redeemed_at)}</td>
                  <td><Link prefetch={false} href={`/t/${t.qr_token}`} className="text-xs underline" target="_blank">View QR</Link></td>
                  {isAdmin && <td className="py-2">{t.converted ? <span className="text-xs text-zinc-500">converted</span> : <TicketActions ticketId={t.id} number={t.number} status={t.status} voidReason={t.void_reason} />}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
