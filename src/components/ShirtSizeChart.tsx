"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRules } from "@/components/RulesProvider";
import { shirtSummary } from "@/lib/rules-types";

/**
 * "Size chart" trigger + modal for ticket types that include the event t-shirt.
 * Uses the native <dialog> so focus trapping, Esc-to-close and the backdrop come
 * for free. The modal shows the supplier's chart image and, below it, the same
 * numbers as a real table so they stay readable (and searchable) on a phone.
 *
 * The <dialog> is portalled to <body>: it is flow content, so rendering it where
 * the trigger sits (inside a <p> or a table cell) would produce invalid HTML and
 * a hydration mismatch. It is first rendered on the first click (so nothing about
 * it reaches the server HTML) and then stays mounted, closed, so the CSS fade-out
 * in globals.css (`dialog.sheet`) can play before it disappears.
 */
export function ShirtSizeChartButton({ highlight, className = "", label = "Size chart" }: { highlight?: string; className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // Sizes, measurements and chart image from Admin > Settings.
  const { shirtChart, shirtChartImage } = useRules();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  const selected = highlight && shirtChart.some((r) => r.size === highlight) ? highlight : null;

  const dialog = (
      <dialog
        ref={ref}
        onClose={() => setOpen(false)}
        onCancel={(e) => { e.preventDefault(); setOpen(false); }}
        onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setOpen(false); } }}
        onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        aria-labelledby={titleId}
        className="sheet m-auto w-[min(100vw-1.5rem,52rem)] max-h-[92vh] overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 p-0 text-zinc-100 shadow-2xl"
      >
          <div className="flex max-h-[92vh] flex-col">
            <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Event t-shirt</p>
                <h2 id={titleId} className="text-lg font-black uppercase italic">Regular shirt size chart</h2>
                <p className="mt-0.5 text-xs text-zinc-400">All measurements are in inches. Lay a shirt that fits you flat and compare.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="btn-secondary h-9 w-9 shrink-0 px-0" aria-label="Close size chart">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>

            <div className="overflow-y-auto px-5 py-4">
              {shirtChartImage && (
                // Uploaded charts come from Storage with unknown dimensions, so a plain img.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={shirtChartImage}
                  alt={`Shirt size chart: width, length and sleeve length in inches for sizes ${shirtChart[0]?.size} to ${shirtChart.at(-1)?.size}`}
                  className="w-full rounded-xl border border-white/10"
                />
              )}

              <table className="mt-4 w-full border-collapse text-sm tabular-nums">
                <caption className="sr-only">Regular shirt measurements in inches</caption>
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-zinc-400">
                    <th scope="col" className="py-2 pr-3 font-semibold">Size</th>
                    <th scope="col" className="py-2 pr-3 font-semibold">Width</th>
                    <th scope="col" className="py-2 pr-3 font-semibold">Length</th>
                    <th scope="col" className="py-2 font-semibold">Sleeve length</th>
                  </tr>
                </thead>
                <tbody>
                  {shirtChart.map((m) => {
                    const s = m.size;
                    const active = s === selected;
                    return (
                      <tr key={s} className={`border-t border-white/10 ${active ? "bg-cyan-400/10 text-cyan-200" : ""}`} aria-current={active ? "true" : undefined}>
                        <th scope="row" className="py-2 pr-3 text-left font-black text-amber-300">{s}{active && <span className="ml-2 rounded bg-cyan-400/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-cyan-200">Selected</span>}</th>
                        <td className="py-2 pr-3">{m.width}</td>
                        <td className="py-2 pr-3">{m.length}</td>
                        <td className="py-2">{m.sleeve}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-zinc-500">Shirt sizes cannot be changed after tickets are issued, so double-check before you pay.</p>
            </div>
          </div>
      </dialog>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => { setEverOpened(true); setOpen(true); }}
        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold text-cyan-300 underline decoration-cyan-300/50 underline-offset-2 transition hover:bg-cyan-400/10 hover:decoration-cyan-300 ${className}`}
      >
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M3 8l5-5 13 13-5 5z" /><path d="M7 7l2 2M10 4l2 2M13 13l2 2M16 10l2 2" />
        </svg>
        {label}
      </button>
      {everOpened && createPortal(dialog, document.body)}
    </>
  );
}

/** Live measurement line under the size dropdown, e.g. "M: Width 20 in · Length 29 in · Sleeve 9.5 in". */
export function ShirtSizeHint({ size }: { size: string }) {
  const summary = shirtSummary(useRules().shirtChart, size);
  if (size && summary) {
    return <p className="mt-1 text-xs text-zinc-400"><span className="font-semibold text-zinc-300">{size}:</span> {summary}</p>;
  }
  return <p className="mt-1 text-xs text-zinc-500">Measurements are in inches. Open the size chart if you are unsure.</p>;
}
