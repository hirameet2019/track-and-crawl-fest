"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { outboxEmailHtml, sendAllWaiting, sendOutboxEmails } from "@/app/actions/outbox";
import type { EmailKind, OutboxRow, OutboxStatus } from "@/lib/outbox";
import { LOCALE } from "@/config/site";

const KIND: Record<EmailKind, string> = {
  received: "Order received",
  reminder: "Payment reminder",
  expiry: "Timer ran out",
  tickets: "Tickets",
  converted: "Ticket changed",
  voided: "Ticket voided",
  rejected: "Payment rejected",
};

const STATUS: Record<OutboxStatus, { label: string; cls: string }> = {
  held: { label: "Waiting", cls: "border-amber-300 bg-amber-50 text-amber-800" },
  failed: { label: "Failed", cls: "border-red-200 bg-red-50 text-red-700" },
  sent: { label: "Sent", cls: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  skipped: { label: "Skipped", cls: "border-zinc-300 bg-zinc-100 text-zinc-600" },
};

const FILTERS: { id: "all" | OutboxStatus; label: string }[] = [
  { id: "all", label: "All" },
  { id: "held", label: "Waiting" },
  { id: "failed", label: "Failed" },
  { id: "sent", label: "Sent" },
  { id: "skipped", label: "Skipped" },
];

const when = (iso: string) => new Date(iso).toLocaleString(LOCALE.locale, { timeZone: LOCALE.timeZone, dateStyle: "medium", timeStyle: "short" });

/**
 * Admin > Settings > Email > Outbox. Every buyer email, newest first: the ones held
 * while no provider was set up, the ones that failed, and the ones that went out.
 */
export function EmailOutbox({
  rows,
  counts,
  ready,
  missing,
}: {
  rows: OutboxRow[];
  counts: Record<OutboxStatus, number>;
  /** An email provider is set up, so sending is possible. */
  ready: boolean;
  /** The email_outbox table does not exist yet (migration not run). */
  missing: boolean;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<"all" | OutboxStatus>(counts.held + counts.failed > 0 ? "held" : "all");
  const [busy, setBusy] = useState<number | "all" | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [preview, setPreview] = useState<{ id: number; html: string } | null>(null);
  const [pending, start] = useTransition();
  const waiting = counts.held + counts.failed;

  if (missing) {
    return (
      <div className="card space-y-2">
        <h2 className="font-semibold">Outbox</h2>
        <p className="text-sm text-zinc-600">
          Not switched on yet. Run <code className="rounded bg-zinc-100 px-1">supabase/migrations/20261028000000_email_outbox.sql</code> in the Supabase SQL editor, then reload this page.
        </p>
      </div>
    );
  }

  const act = (target: number | "all", fn: () => Promise<{ ok: true; warning?: string } | { ok: false; error: string }>) => {
    setMsg(null);
    setBusy(target);
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? { kind: "ok", text: r.warning ?? "Done." } : { kind: "err", text: r.error });
      setBusy(null);
      router.refresh();
    });
  };

  const showPreview = (id: number) => {
    if (preview?.id === id) return setPreview(null);
    start(async () => {
      const r = await outboxEmailHtml(id);
      if (r.ok) setPreview({ id, html: r.html });
      else setMsg({ kind: "err", text: r.error });
    });
  };

  const shown = filter === "all" ? rows : rows.filter((r) => r.status === filter);

  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Outbox</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            Every email sent to buyers. While no email provider is set up they wait here; once SMTP works, send them from here. Failed ones can be sent again.
            Ticket emails are rebuilt when sent, so they show the tickets that are valid at that moment. Payment reminders are not kept: their countdown is over by then.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary whitespace-nowrap"
          disabled={pending || !ready || waiting === 0}
          onClick={() => act("all", sendAllWaiting)}
        >
          {busy === "all" ? "Sending..." : `Send all waiting (${waiting})`}
        </button>
      </div>

      {!ready && waiting > 0 && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          {waiting} email{waiting === 1 ? " is" : "s are"} waiting. Save working SMTP settings above (and try Send test), then press Send all waiting.
        </p>
      )}

      {msg && (
        <p role="status" className={`rounded-lg border p-3 text-sm ${msg.kind === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-700"}`}>{msg.text}</p>
      )}

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const n = f.id === "all" ? counts.held + counts.failed + counts.sent + counts.skipped : counts[f.id];
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${filter === f.id ? "border-cyan-400 bg-cyan-50 text-cyan-800" : "border-zinc-300 text-zinc-600"}`}
            >
              {f.label} {n}
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-500">Nothing here.</p>
      ) : (
        <ul className="divide-y divide-zinc-200">
          {shown.map((r) => {
            const st = STATUS[r.status];
            const canSend = r.status !== "skipped";
            return (
              <li key={r.id} className="space-y-2 py-3">
                <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${st.cls}`}>{st.label}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">
                      {KIND[r.kind] ?? r.kind}
                      {r.order && r.order_id && (
                        <> &middot; <Link className="text-cyan-700 underline" href={`/admin/orders/${r.order_id}`}>Order #{r.order.order_no}</Link></>
                      )}
                      {r.has_pdf && <span className="ml-1.5 text-[11px] text-zinc-500">+ PDF</span>}
                    </div>
                    <div className="truncate text-xs text-zinc-500">To {r.to_email} &middot; {r.subject}</div>
                    <div className="text-[11px] text-zinc-500">
                      {when(r.created_at)}
                      {r.sent_at && <> &middot; sent {when(r.sent_at)}</>}
                      {r.attempts > 1 && <> &middot; {r.attempts} tries</>}
                    </div>
                    {r.error && <div className={`mt-1 text-xs ${r.status === "failed" ? "text-red-700" : "text-zinc-600"}`}>{r.error}</div>}
                  </div>
                  <div className="flex gap-1.5">
                    <button type="button" className="btn-secondary px-3 py-1 text-xs" disabled={pending && preview?.id !== r.id} onClick={() => showPreview(r.id)}>
                      {preview?.id === r.id ? "Hide" : "View"}
                    </button>
                    {canSend && (
                      <button
                        type="button"
                        className="btn-secondary px-3 py-1 text-xs"
                        disabled={pending || !ready}
                        title={ready ? undefined : "Set up SMTP first"}
                        onClick={() => act(r.id, () => sendOutboxEmails([r.id]))}
                      >
                        {busy === r.id ? "Sending..." : r.status === "sent" ? "Resend" : "Send"}
                      </button>
                    )}
                  </div>
                </div>
                {preview?.id === r.id && (
                  <iframe title={`Email ${r.id}`} sandbox="" srcDoc={preview.html} className="h-96 w-full rounded-lg border border-zinc-300" style={{ background: "#fff" }} />
                )}
              </li>
            );
          })}
        </ul>
      )}
      {rows.length >= 200 && <p className="text-xs text-zinc-500">Showing the latest 200.</p>}
    </div>
  );
}
