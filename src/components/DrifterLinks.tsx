"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addDrifterEntries, removeDrifterEntry, setDrifterSignup } from "@/app/actions/drifter-entries";
import { drifterLink, drifterReference } from "@/lib/drifter";
import { useRules } from "@/components/RulesProvider";
import type { DrifterEntryRow } from "@/lib/supabase/types";

/**
 * Split a pasted list into drifters. Accepts what people actually paste: rows
 * copied out of Excel (tab-separated), or lines typed as "Name, Team, Car" or
 * "Name | Team | Car". A leading "#" on the car number is dropped.
 */
function parseList(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const sep = line.includes("\t") ? "\t" : line.includes("|") ? "|" : ",";
      const [name = "", team = "", car = ""] = line.split(sep).map((p) => p.trim());
      return { name, team: team || undefined, car: car.replace(/^#/, "") || undefined };
    })
    .filter((r) => r.name.length > 0);
}

/** Status pill; never wraps inside itself. */
const PILL = "inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide";

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Admin: the organizer's entry list and each drifter's private link. Add drifters
 * one at a time or paste the whole list, then copy each link into Messenger.
 */
export function DrifterLinks({ entries, siteUrl, signupSlug }: { entries: DrifterEntryRow[]; siteUrl: string; signupSlug: string | null }) {
  const prefix = useRules().drifterReferencePrefix;
  const router = useRouter();
  const [name, setName] = useState("");
  const [team, setTeam] = useState("");
  const [car, setCar] = useState("");
  const [bulk, setBulk] = useState("");
  const [showBulk, setShowBulk] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [pending, start] = useTransition();

  const live = entries.filter((e) => e.active);
  const counts = {
    waiting: live.filter((e) => !e.submitted_at).length,
    submitted: live.filter((e) => e.submitted_at && !e.handed_over_at).length,
    done: live.filter((e) => e.handed_over_at).length,
  };
  const preview = parseList(bulk);

  function add(rows: { name: string; team?: string; car?: string }[], after: () => void) {
    setMsg(null);
    start(async () => {
      const r = await addDrifterEntries(rows);
      if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
      const skipped = r.skipped ?? [];
      setMsg({
        ok: true,
        text: `Added ${r.added} drifter${r.added === 1 ? "" : "s"}.${skipped.length ? ` Skipped ${skipped.length} already on the list: ${skipped.slice(0, 5).join(", ")}${skipped.length > 5 ? "…" : ""}.` : ""}`,
      });
      after();
      router.refresh();
    });
  }

  async function copyOne(e: DrifterEntryRow) {
    const ok = await copy(drifterLink(siteUrl, e.token));
    setCopied(ok ? e.id : null);
    if (!ok) setMsg({ ok: false, text: "Copy was blocked by the browser. Select the link text and copy it by hand." });
    else setTimeout(() => setCopied((c) => (c === e.id ? null : c)), 1800);
  }

  async function copyAll() {
    // Tab-separated so it pastes straight into Excel as columns.
    const text = live.map((e) => [e.drifter_name, e.team_name ?? "", e.car_no ?? "", drifterLink(siteUrl, e.token)].join("\t")).join("\n");
    const ok = await copy(text);
    setMsg(ok
      ? { ok: true, text: `Copied ${live.length} rows (name, team, car, link). Paste into Excel or a note.` }
      : { ok: false, text: "Copy was blocked by the browser. Copy each link from the list below instead." });
  }

  const signupUrl = signupSlug ? `${siteUrl.replace(/\/$/, "")}/drifters/${signupSlug}` : null;
  const signup = (a: "open" | "replace" | "close", done: string) =>
    start(async () => {
      const r = await setDrifterSignup(a);
      setReplacing(false);
      setMsg(r.ok ? { ok: true, text: done } : { ok: false, text: r.error });
      router.refresh();
    });

  return (
    <div className="card space-y-4 p-4">
      {/* One link for every drifter, for when there is no final entry list. */}
      <div className={`rounded-lg border p-3 ${signupUrl ? "border-cyan-400/30 bg-cyan-400/5" : "border-white/10 bg-black/20"}`}>
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">Shared sign-up link</h2>
          <span className={`${PILL} ${signupUrl ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-300" : "border-white/15 text-zinc-400"}`}>
            {signupUrl ? "Open" : "Closed"}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-zinc-500">
          One link for all drifters, for when there is no final list. Each drifter types their own name, team and car number and
          gets a personal link back. Entries made this way are marked <b>Self</b>: check the competitor pass before handing over.
        </p>
        {signupUrl ? (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input readOnly className="input min-w-0 flex-1 py-1.5 font-mono text-xs" value={signupUrl} onFocus={(e) => e.currentTarget.select()} aria-label="Shared drifter sign-up link" />
              <button type="button" className="btn-primary shrink-0 px-3 py-1.5 text-sm" onClick={async () => {
                const ok = await copy(signupUrl);
                setMsg(ok ? { ok: true, text: "Sign-up link copied. Post it to the drifters only." } : { ok: false, text: "Copy was blocked. Select the link and copy it by hand." });
              }}>Copy</button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
              {replacing ? (
                <>
                  <span className="text-amber-200">The old link stops working immediately.</span>
                  <button type="button" className="btn-secondary px-2 py-1 text-xs" disabled={pending} onClick={() => signup("replace", "New sign-up link made. The old one no longer works.")}>Make a new link</button>
                  <button type="button" className="text-zinc-400 hover:underline" onClick={() => setReplacing(false)}>Cancel</button>
                </>
              ) : (
                <>
                  <button type="button" className="text-cyan-300 hover:underline" onClick={() => setReplacing(true)}>Replace the link&hellip;</button>
                  <button type="button" className="text-zinc-400 hover:text-rose-300" disabled={pending} onClick={() => signup("close", "Sign-up link closed. Drifters who already signed up keep their personal links.")}>Close sign-up</button>
                </>
              )}
            </div>
          </>
        ) : (
          <button type="button" className="btn-primary mt-3" disabled={pending} onClick={() => signup("open", "Sign-up link is open. Copy it and send it to the drifters.")}>
            Open a sign-up link
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 max-w-3xl">
          <h2 className="font-semibold">Drifter links</h2>
          <p className="text-xs text-zinc-500">
            Everyone signed up or added by hand. Each drifter has a private link to send in or change who is coming with them.
            {live.length > 0 && <> {counts.waiting} waiting &middot; {counts.submitted} sent a list &middot; {counts.done} handed over.</>}
          </p>
        </div>
        {live.length > 0 && (
          <div className="flex gap-3 whitespace-nowrap text-xs">
            <button type="button" className="text-cyan-300 hover:underline" onClick={copyAll}>Copy all links</button>
          </div>
        )}
      </div>

      {/* one drifter */}
      <form
        className="grid gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_6rem_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim().length < 2) { setMsg({ ok: false, text: "Enter the drifter's full name." }); return; }
          add([{ name: name.trim(), team: team.trim() || undefined, car: car.trim().replace(/^#/, "") || undefined }], () => { setName(""); setTeam(""); setCar(""); });
        }}
      >
        <input id="link-name" className="input" placeholder="Drifter full name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Drifter full name" />
        <input id="link-team" className="input" placeholder="Team (optional)" value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Team" />
        <input id="link-car" className="input" placeholder="Car #" value={car} onChange={(e) => setCar(e.target.value)} aria-label="Car number" />
        <button className="btn-primary" disabled={pending}>{pending ? "…" : "Add"}</button>
      </form>

      {/* the whole list at once */}
      <div>
        <button type="button" className="text-xs text-cyan-300 hover:underline" onClick={() => setShowBulk((v) => !v)} aria-expanded={showBulk}>
          {showBulk ? "Hide the paste box" : "Paste the whole entry list"}
        </button>
        {showBulk && (
          <div className="mt-2 space-y-2">
            <textarea
              id="link-bulk"
              className="input min-h-32 font-mono text-xs"
              placeholder={"One drifter per line. Copy the rows straight out of Excel, or type:\nJuan Dela Cruz, Team Burnout, 17\nMarco Villanueva, Smokestack Garage, 04"}
              value={bulk}
              onChange={(e) => setBulk(e.target.value)}
              aria-label="Paste the entry list"
            />
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="btn-primary"
                disabled={pending || preview.length === 0}
                onClick={() => add(preview, () => { setBulk(""); setShowBulk(false); })}
              >
                {preview.length === 0 ? "Nothing to add yet" : `Add ${preview.length} drifter${preview.length === 1 ? "" : "s"}`}
              </button>
              {preview.length > 0 && (
                <span className="text-xs text-zinc-500">
                  First line reads as: <b className="text-zinc-300">{preview[0].name}</b>
                  {preview[0].team && <> &middot; {preview[0].team}</>}
                  {preview[0].car && <> &middot; Car #{preview[0].car}</>}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {msg && <p className={`rounded-lg border p-2 text-xs ${msg.ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-rose-500/40 bg-rose-500/10 text-rose-300"}`}>{msg.text}</p>}

      {live.length === 0 ? (
        <p className="text-sm text-zinc-500">No drifters yet. Open the shared sign-up link above, or add drifters by hand.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm [&_td]:px-3 [&_th]:px-3 [&_td:first-child]:pl-0 [&_th:first-child]:pl-0 [&_td:last-child]:pr-0 [&_th:last-child]:pr-0">
            <thead className="text-left text-xs uppercase text-zinc-500">
              <tr><th className="py-1">Drifter &amp; team</th><th>Status</th><th className="w-[40%]">Private link</th><th></th></tr>
            </thead>
            <tbody>
              {live.map((e) => (
                <tr key={e.id} className="border-t border-white/10 align-middle">
                  <td className="py-2.5">
                    <div className="flex items-center gap-2 font-semibold">
                      <span className="min-w-0">{e.drifter_name}</span>
                      {e.self_registered && <span className="shrink-0 rounded border border-amber-500/40 px-1 text-[10px] font-semibold uppercase text-amber-300" title="Signed up through the shared link">Self</span>}
                    </div>
                    <div className="text-xs text-zinc-500">{[e.team_name ?? "no team", e.car_no ? `Car #${e.car_no}` : null].filter(Boolean).join(" · ")}</div>
                    {e.contact_email && <div className="text-xs text-zinc-500">{e.contact_email}</div>}
                  </td>
                  <td className="py-2.5 text-[10px]">
                    {!e.handed_over_at && e.bands_given > 0 ? (
                      <span className={`${PILL} border-cyan-400/35 bg-cyan-400/10 text-cyan-300`}>{e.bands_given}/{e.band_count} collected</span>
                    ) : e.handed_over_at ? (
                      <span className={`${PILL} border-emerald-500/35 bg-emerald-500/10 text-emerald-300`}>Handed over</span>
                    ) : e.submitted_at ? (
                      <span className={`${PILL} border-cyan-400/35 bg-cyan-400/10 text-cyan-300`}>List in &middot; {e.band_count}</span>
                    ) : (
                      <span className={`${PILL} border-amber-500/35 bg-amber-500/10 text-amber-300`}>Waiting</span>
                    )}
                  </td>
                  <td className="py-2.5">
                    <div className="flex items-center gap-2">
                      <input
                        readOnly
                        className="input min-w-0 flex-1 py-1 font-mono text-xs"
                        value={drifterLink(siteUrl, e.token)}
                        onFocus={(ev) => ev.currentTarget.select()}
                        aria-label={`Private link for ${e.drifter_name}`}
                      />
                      <button type="button" className="btn-secondary shrink-0 px-2 py-1 text-xs" onClick={() => copyOne(e)}>
                        {copied === e.id ? "Copied" : "Copy"}
                      </button>
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-zinc-500">{drifterReference(e.token, prefix)}</div>
                  </td>
                  <td className="whitespace-nowrap py-2.5 text-right">
                    {removing === e.id ? (
                      <span className="inline-flex gap-1">
                        <button
                          type="button"
                          className="btn-danger px-2 py-1 text-xs"
                          disabled={pending}
                          onClick={() => start(async () => {
                            const r = await removeDrifterEntry(e.id);
                            setRemoving(null);
                            setMsg(r.ok ? { ok: true, text: `${e.drifter_name} removed; their link no longer works.` } : { ok: false, text: r.error });
                            router.refresh();
                          })}
                        >
                          Remove
                        </button>
                        <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => setRemoving(null)}>Keep</button>
                      </span>
                    ) : (
                      <button type="button" className="text-xs text-zinc-500 hover:text-rose-300" onClick={() => setRemoving(e.id)}>Remove…</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
