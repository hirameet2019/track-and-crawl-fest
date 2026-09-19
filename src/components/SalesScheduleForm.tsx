"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setSalesCutoff } from "@/app/actions/admin";
import { fmtCutoff, fromManilaLocalInput, hoursUntilCutoff, isTypeClosed, toManilaLocalInput } from "@/lib/cutoff";
import { BandSwatch } from "@/components/BandSwatch";
import type { TicketTypeRow } from "@/lib/supabase/types";

/**
 * Admin > Settings > Sales schedule. One row per ticket type sold online with
 * its cut-off in Manila time. "Close now" stops sales immediately, "Reopen"
 * clears the cut-off, and a saved date closes automatically at that minute.
 */
export function SalesScheduleForm({ types }: { types: TicketTypeRow[] }) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(types.map((t) => [t.id, toManilaLocalInput(t.sales_close_at)])));
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  const apply = (t: TicketTypeRow, iso: string | null, okMsg: string) =>
    start(async () => {
      const r = await setSalesCutoff(t.id, iso);
      setMsg((m) => ({ ...m, [t.id]: r.ok ? okMsg : r.error ?? "Failed" }));
      if (r.ok) { setDrafts((d) => ({ ...d, [t.id]: toManilaLocalInput(iso) })); router.refresh(); }
    });

  return (
    <div className="card space-y-4">
      <div>
        <h2 className="font-semibold">Sales schedule</h2>
        <p className="text-sm text-zinc-500">When online buying stops for each ticket type, Manila time. Buyers see the date on the ticket card, and the + button is disabled after it. You can move the date or reopen sales any time; orders already placed are not affected.</p>
      </div>
      <ul className="divide-y divide-white/10">
        {types.map((t) => {
          const closed = isTypeClosed(t);
          const hrs = hoursUntilCutoff(t);
          const status = closed
            ? { label: "Closed", cls: "bg-red-100 text-red-800" }
            : hrs === null
              ? { label: "Open, no cut-off", cls: "bg-emerald-100 text-emerald-800" }
              : hrs <= 48
                ? { label: `Closes in ${Math.max(1, Math.round(hrs))} h`, cls: "bg-amber-100 text-amber-800" }
                : { label: `Open until ${fmtCutoff(t.sales_close_at!)}`, cls: "bg-emerald-100 text-emerald-800" };
          return (
            <li key={t.id} className="space-y-2 py-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-semibold">{t.name}</span>
                <BandSwatch color={t.band_color} className="rounded-full border border-white/15 bg-black/30 px-2 py-0.5 text-[11px] text-zinc-300" />
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${status.cls}`}>{status.label}</span>
              </div>
              <div className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[minmax(0,15rem)_auto_auto_auto]">
                <input
                  type="datetime-local"
                  className="input h-10 min-w-0"
                  value={drafts[t.id] ?? ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [t.id]: e.target.value }))}
                  aria-label={`${t.name} cut-off`}
                />
                <button
                  type="button"
                  className="btn-primary h-10 whitespace-nowrap px-4"
                  disabled={pending || !drafts[t.id] || fromManilaLocalInput(drafts[t.id]) === null}
                  onClick={() => { const iso = fromManilaLocalInput(drafts[t.id]); if (iso) apply(t, iso, `Saved. Closes ${fmtCutoff(iso)}.`); }}
                >
                  Save date
                </button>
                <button type="button" className="btn-danger h-10 whitespace-nowrap px-4 disabled:opacity-40" disabled={pending || closed} onClick={() => apply(t, new Date().toISOString(), "Closed. Buyers can no longer add this ticket.")}>Close now</button>
                <button type="button" className="btn-secondary h-10 whitespace-nowrap px-4 disabled:opacity-40" disabled={pending || !t.sales_close_at} onClick={() => apply(t, null, "Reopened with no cut-off.")}>Reopen</button>
              </div>
              {msg[t.id] && <div className="text-xs text-zinc-400">{msg[t.id]}</div>}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-zinc-500">Organizer&apos;s schedule: Early Bird Adult and Child close end of Oct 8; VIP Car Display and VIP Standing close end of Oct 4. Companions inside a VIP Car ticket follow the VIP Standing cut-off.</p>
    </div>
  );
}
