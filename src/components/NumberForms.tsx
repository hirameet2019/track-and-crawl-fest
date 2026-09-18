"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { importNumberList, importNumberRange, voidNumber } from "@/app/actions/admin";
import type { TicketTypeRow } from "@/lib/supabase/types";

type Num = { id: string; number: string; seq: number; status: string; void_reason: string | null };

export function NumberForms({ ticketType, numbers }: { ticketType: TicketTypeRow; numbers: Num[] }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [filter, setFilter] = useState("");
  const [voiding, setVoiding] = useState<Num | null>(null);
  const [voidReason, setVoidReason] = useState("damaged band");

  function onRange(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const r = await importNumberRange(fd);
      setMsg(r.ok ? `Imported ${r.inserted} numbers` : r.error);
      if (r.ok) router.refresh();
    });
  }
  function onList(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const r = await importNumberList(fd);
      setMsg(r.ok ? `Imported ${r.inserted} numbers` : r.error);
      if (r.ok) router.refresh();
    });
  }
  function confirmVoid() {
    const n = voiding;
    if (!n) return;
    start(async () => {
      const r = await voidNumber(n.id, voidReason);
      setMsg(r.ok ? `${n.number} voided` : r.error);
      if (r.ok) {
        setVoiding(null);
        setVoidReason("damaged band");
        router.refresh();
      }
    });
  }

  const shown = numbers.filter((n) => !filter || n.number.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold">{ticketType.name}</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        <form onSubmit={onRange} className="card space-y-3">
          <h3 className="font-semibold">Import a range</h3>
          <input type="hidden" name="ticket_type_id" value={ticketType.id} />
          <div className="grid grid-cols-4 gap-2">
            <div><label className="label">Prefix</label><input name="prefix" className="input" placeholder={`${ticketType.code}-`} /></div>
            <div><label className="label">Start</label><input name="start" type="number" className="input" defaultValue={1} required /></div>
            <div><label className="label">End</label><input name="end" type="number" className="input" required /></div>
            <div><label className="label">Pad</label><input name="pad" type="number" className="input" defaultValue={4} /></div>
          </div>
          <p className="text-xs text-zinc-500">Example: prefix VIP-, 1 to 500, pad 4 produces VIP-0001 to VIP-0500. Existing numbers are skipped.</p>
          <button className="btn-primary" disabled={pending}>Import range</button>
        </form>
        <form onSubmit={onList} className="card space-y-3">
          <h3 className="font-semibold">Paste a list</h3>
          <input type="hidden" name="ticket_type_id" value={ticketType.id} />
          <textarea name="numbers" className="input h-28 font-mono text-xs" placeholder={"One number per line, exactly as printed\nA1043\nA1044"} />
          <button className="btn-primary" disabled={pending}>Import list</button>
        </form>
      </div>
      {msg && <p className="rounded bg-zinc-100 p-2 text-sm">{msg}</p>}

      <div className="card">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold">Pool ({numbers.length}{numbers.length >= 2000 ? "+" : ""})</h3>
          <input className="input max-w-xs" placeholder="Find number" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <div className="mt-3 flex max-h-96 flex-wrap gap-1 overflow-y-auto">
          {shown.map((n) => (
            <button
              key={n.id}
              type="button"
              title={n.status === "void" ? `Void: ${n.void_reason}` : n.status}
              onClick={() => n.status === "available" && setVoiding(n)}
              className={`rounded px-2 py-0.5 font-mono text-xs ${
                n.status === "available" ? "bg-emerald-50 text-emerald-800 hover:bg-red-100" : n.status === "assigned" ? "bg-zinc-800 text-white" : "bg-red-100 text-red-700 line-through"
              }`}
            >
              {n.number}
            </button>
          ))}
          {shown.length === 0 && <p className="text-sm text-zinc-500">No numbers yet. Import a range above.</p>}
        </div>
        <p className="mt-2 text-xs text-zinc-500">Green = available (click to void), dark = assigned to a ticket, red = void.</p>
        {voiding && (
          <div className="mt-3 flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 p-3 sm:flex-row sm:items-center">
            <div className="text-sm text-red-900">
              Void <b className="font-mono">{voiding.number}</b>? It will be skipped and never assigned.
            </div>
            <input
              className="input sm:max-w-xs"
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="Reason, e.g. damaged band"
              autoFocus
            />
            <div className="flex gap-2">
              <button type="button" className="btn-danger" disabled={pending || !voidReason.trim()} onClick={confirmVoid}>
                {pending ? "Voiding..." : "Confirm void"}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setVoiding(null)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
