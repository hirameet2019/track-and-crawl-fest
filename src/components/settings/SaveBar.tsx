"use client";

import { useId } from "react";

export type SaveMsg = { kind: "ok" | "err"; text: string } | null;

export { changed } from "@/lib/same-value";

/**
 * The footer every Settings form shares: Save (enabled only when something
 * changed), Discard, and the result message right under it.
 */
export function SaveBar({
  label,
  dirty,
  pending,
  msg,
  onSave,
  onDiscard,
  extra,
}: {
  label: string;
  dirty: boolean;
  pending: boolean;
  msg: SaveMsg;
  onSave: () => void;
  onDiscard: () => void;
  /** Right-aligned extra action, e.g. "Back to defaults". */
  extra?: React.ReactNode;
}) {
  return (
    <div className="space-y-3 border-t border-white/10 pt-5">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary" disabled={pending || !dirty} onClick={onSave}>
          {pending ? "Saving..." : label}
        </button>
        {dirty && !pending && (
          <button type="button" className="btn-secondary" onClick={onDiscard}>Discard changes</button>
        )}
        {dirty && !pending && <span className="text-xs text-amber-300">Unsaved changes</span>}
        {/* Right-aligned beside the buttons; when a phone wraps it, it stays left under them. */}
        {extra && <div className="sm:ml-auto">{extra}</div>}
      </div>
      {msg && (
        <p role="status" className={`rounded-lg border p-3 text-sm ${msg.kind === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-700"}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}

/** A titled group inside a Settings card. */
export function Group({ title, hint, children }: { title: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-3 border-t border-white/10 pt-5 first:border-t-0 first:pt-0">
      <div>
        <h3 className="text-sm font-semibold text-white/90">{title}</h3>
        {hint && <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/** Number input that keeps the state a number (blank becomes 0, the server rejects it). */
export function NumberField({ label, value, onChange, min, max, step, hint, suffix }: {
  label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; hint?: string; suffix?: string;
}) {
  const id = useId();
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <div className="flex items-center gap-2">
        <input id={id} className="input h-9" type="number" min={min} max={max} step={step} value={Number.isFinite(value) ? value : ""} onChange={(e) => onChange(Number(e.target.value))} />
        {suffix && <span className="shrink-0 text-xs text-zinc-500">{suffix}</span>}
      </div>
      {hint && <p className="mt-1 text-[11px] text-zinc-500">{hint}</p>}
    </div>
  );
}
