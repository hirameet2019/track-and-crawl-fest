"use client";

import { useEffect, useId, useState } from "react";
import { PAYMENT_WINDOW_MINUTES, PAY_VIA } from "@/config/event";
import { php } from "@/lib/money";
import type { TicketTypeRow } from "@/lib/supabase/types";
import { BandSwatch } from "@/components/BandSwatch";

export interface ReviewAttendee {
  holder_name: string;
  shirt_size: string;
  vehicle_plate: string;
  vehicle_model: string;
  photo_preview: string | null;
  /** Passengers added inside a VIP Car Display ticket (become VIP Pass tickets). */
  companions?: { holder_name: string; shirt_size: string }[];
}
export interface ReviewLine {
  type: TicketTypeRow;
  qty: number;
  attendees: ReviewAttendee[];
}

/**
 * Last look before the order is reserved: what was picked, who holds each
 * ticket, where the tickets will be sent, and what happens next. Nothing is
 * written until the buyer confirms.
 */
export function OrderReviewModal({
  lines,
  buyer,
  total,
  pending,
  onClose,
  onConfirm,
  companionPrice = 0,
  companionLabel = "VIP Pass",
}: {
  lines: ReviewLine[];
  companionPrice?: number;
  companionLabel?: string;
  buyer: { buyer_name: string; buyer_email: string; buyer_mobile: string };
  total: number;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [agreed, setAgreed] = useState(false);
  const titleId = useId();
  const companionsOf = (attendees: ReviewAttendee[]) => attendees.reduce((n, a) => n + (a.companions?.length ?? 0), 0);
  const count = lines.reduce((n, l) => n + l.qty + companionsOf(l.attendees), 0);

  // Escape closes; lock page scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, pending]);

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-6" onClick={() => !pending && onClose()} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className="modal-panel dark-zone relative flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-[#0d0d12] text-zinc-100 shadow-[0_30px_120px_rgba(0,0,0,0.7)] sm:rounded-3xl"
      >
        {/* neon brand stripe */}
        <div className="h-1 w-full bg-gradient-to-r from-fuchsia-500 via-violet-500 via-40% to-cyan-400" aria-hidden />
        <div className="pointer-events-none absolute -top-24 right-0 h-56 w-56 rounded-full bg-fuchsia-500/20 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-24 left-0 h-56 w-56 rounded-full bg-cyan-400/15 blur-3xl" aria-hidden />

        <header className="relative flex items-start justify-between gap-4 px-5 pt-5 sm:px-7">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-cyan-300">Step 1 of 3 · Review</p>
            <h2 id={titleId} className="mt-1 text-2xl font-black uppercase italic leading-tight">Check your order</h2>
            <p className="mt-1 text-sm text-zinc-400">Nothing is reserved yet. Make sure every name is spelled the way it should appear on the ticket.</p>
          </div>
          <button type="button" onClick={onClose} disabled={pending} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/15 bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-white" aria-label="Close and keep editing">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>

        <div className="relative flex-1 space-y-4 overflow-y-auto px-5 py-5 sm:px-7">
          {/* tickets */}
          <section className="rounded-2xl border border-white/10 bg-white/[0.04]">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
              <span>Tickets</span><span>{count} total</span>
            </div>
            <ul className="divide-y divide-white/10">
              {lines.map(({ type: t, qty, attendees }) => (
                <li key={t.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="grid h-7 w-7 place-items-center rounded-md bg-white/10 text-sm font-black">{t.code}</span>
                        <span className="font-semibold">{t.name}</span>
                        <BandSwatch color={t.band_color} size={11} className="text-[11px] text-zinc-400" />
                      </div>
                      <div className="mt-0.5 text-xs text-zinc-500">
                        {qty} × {php(t.price_centavos)}
                        {companionsOf(attendees) > 0 && <> + {companionsOf(attendees)} companion{companionsOf(attendees) === 1 ? "" : "s"} × {php(companionPrice)}</>}
                      </div>
                    </div>
                    <div className="shrink-0 text-right font-bold tabular-nums">{php(qty * t.price_centavos + companionsOf(attendees) * companionPrice)}</div>
                  </div>
                  <ol className="mt-2 space-y-1.5">
                    {attendees.map((a, i) => (
                      <li key={i} className="flex items-center gap-3 rounded-lg bg-black/30 px-3 py-2 text-sm">
                        {a.photo_preview ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={a.photo_preview} alt={`Car ${a.vehicle_plate}`} className="h-10 w-14 shrink-0 rounded-md border border-white/10 object-cover" />
                        ) : (
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/10 text-[11px] font-bold text-zinc-300">{i + 1}</span>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{a.holder_name || <span className="text-rose-300">No name</span>}</div>
                          <div className="truncate text-xs text-zinc-400">
                            {[t.includes_shirt ? `Shirt ${a.shirt_size || "?"}` : null, t.requires_vehicle ? `${a.vehicle_plate || "no plate"} · ${a.vehicle_model || "no model"}` : null].filter(Boolean).join(" · ") || "General admission"}
                          </div>
                          {(a.companions?.length ?? 0) > 0 && (
                            <ul className="mt-1.5 space-y-1 border-l-2 border-emerald-400/40 pl-2">
                              {a.companions!.map((c, k) => (
                                <li key={k} className="flex items-center justify-between gap-2 text-xs">
                                  <span className="truncate"><span className="text-emerald-300">Riding with this car:</span> {c.holder_name || <span className="text-rose-300">No name</span>} · Shirt {c.shirt_size || "?"} · {companionLabel}, Green wristband</span>
                                  <span className="shrink-0 tabular-nums text-zinc-300">{php(companionPrice)}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                </li>
              ))}
            </ul>
          </section>

          {/* buyer */}
          <section className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4 sm:grid-cols-3">
            <div className="sm:col-span-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Tickets will be sent to</div>
            <div><div className="text-[10px] uppercase text-zinc-500">Name</div><div className="font-medium">{buyer.buyer_name}</div></div>
            <div className="min-w-0"><div className="text-[10px] uppercase text-zinc-500">Email</div><div className="break-all font-medium text-cyan-200">{buyer.buyer_email}</div></div>
            <div><div className="text-[10px] uppercase text-zinc-500">Mobile</div><div className="font-medium">{buyer.buyer_mobile}</div></div>
          </section>

          {/* what happens next */}
          <section className="rounded-2xl border border-cyan-400/20 bg-cyan-400/5 p-4 text-sm">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-cyan-300">What happens next</div>
            <ol className="mt-2 space-y-1.5 text-zinc-300">
              <li className="flex gap-2"><span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-cyan-300 text-[11px] font-black text-black">1</span><span>Your wristbands are held for <b className="text-white">{PAYMENT_WINDOW_MINUTES} minutes</b>.</span></li>
              <li className="flex gap-2"><span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-cyan-300 text-[11px] font-black text-black">2</span><span>Pay exactly <b className="text-white">{php(total)}</b> via {PAY_VIA} and upload the confirmation screenshot.</span></li>
              <li className="flex gap-2"><span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-cyan-300 text-[11px] font-black text-black">3</span><span>A team member verifies the payment by hand and emails your QR tickets and receipt <b className="text-white">within 24 hours</b>, usually much sooner. <span className="text-amber-200">Check your Spam or Junk folder if it does not show up in your inbox.</span></span></li>
            </ol>
            <p className="mt-2 text-xs text-zinc-400">Sa Tagalog: naka-hold ang wristbands ng {PAYMENT_WINDOW_MINUTES} minuto. Bayaran ang eksaktong {php(total)} via GoTyme, i-upload ang screenshot, at ipapadala ang tickets sa email pagkatapos ma-verify.</p>
          </section>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-black/30 p-3 text-sm">
            <input type="checkbox" className="mt-0.5 h-5 w-5 accent-cyan-300" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            <span>The names and details above are correct. I understand the wristband is matched to the ticket holder&apos;s name and cannot be renamed after payment.</span>
          </label>
        </div>

        <footer className="relative flex flex-col-reverse gap-2 border-t border-white/10 bg-black/40 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <button type="button" onClick={onClose} disabled={pending} className="btn-secondary">&larr; Go back and edit</button>
          <div className="flex items-center justify-between gap-4 sm:justify-end">
            <div className="text-right">
              <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-400">Total</div>
              <div className="text-2xl font-black tabular-nums">{php(total)}</div>
            </div>
            <button type="button" onClick={onConfirm} disabled={!agreed || pending} className="btn-neon">
              {pending ? "Reserving…" : "Confirm & reserve"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
