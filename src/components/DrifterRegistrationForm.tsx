"use client";

import { useState, useTransition } from "react";
import { selfRegisterDrifter, submitDrifterRegistration } from "@/app/actions/drifter-entries";
import { DRIFTER_CONFIRMATION, drifterRules } from "@/lib/drifter-rules";
import { drifterLink, drifterReference } from "@/lib/drifter";
import { DRIFTER_ROLES, type DrifterRole } from "@/lib/supabase/types";
import { rememberDrifterLink } from "@/components/DrifterLinkMemory";
import { RuleLines, RulesHeading } from "@/components/RuleLines";

type Person = { name: string; role: DrifterRole };

const MAX = 20;

/**
 * What a drifter fills in: who is coming with them and a confirmation of the
 * rules. Two ways in:
 *   - "entry": their personal link. Name and team come from the entry list and
 *     are shown, not asked for. Resubmitting replaces the list until hand-over.
 *   - "signup": the organizer's shared link. The drifter types their own name,
 *     team and car number; submitting creates their entry and hands back a
 *     personal link for later changes.
 */
export function DrifterRegistrationForm({
  mode = "entry",
  slug,
  siteUrl,
  token: initialToken = "",
  drifterName = "",
  teamName = null,
  carNo = null,
  allowance,
  priceLabel,
  initialPeople = [],
  submittedAt = null,
}: {
  mode?: "entry" | "signup";
  /** Shared sign-up slug; signup mode only. */
  slug?: string;
  /** Used to show the personal link after a sign-up. */
  siteUrl?: string;
  token?: string;
  drifterName?: string;
  teamName?: string | null;
  carNo?: string | null;
  allowance: number;
  priceLabel: string;
  initialPeople?: Person[];
  submittedAt?: string | null;
}) {
  const signup = mode === "signup";
  const [token, setToken] = useState(initialToken);
  const [who, setWho] = useState({ name: drifterName, team: teamName ?? "", car: carNo ?? "", email: "" });
  const [emailedTo, setEmailedTo] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [people, setPeople] = useState<Person[]>(
    initialPeople.length > 0 ? initialPeople : [{ name: "", role: "Family" }],
  );
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Opens on the confirmation screen when a list is already in, so a drifter who
  // re-opens their link sees it is done instead of a form that looks empty.
  const [done, setDone] = useState(submittedAt !== null && initialPeople.length > 0);
  const [pending, start] = useTransition();

  const count = people.length;
  const extra = Math.max(0, count - allowance);
  const blanks = people.filter((p) => p.name.trim().length < 2).length;
  const nameMissing = signup && who.name.trim().length < 2;
  const ready = ack && blanks === 0 && !nameMissing && !pending;
  const shownName = signup ? who.name.trim() : drifterName;

  const setCount = (n: number) => {
    const next = Math.max(1, Math.min(MAX, n));
    setPeople((prev) => {
      const copy = prev.slice(0, next);
      while (copy.length < next) copy.push({ name: "", role: "Family" });
      return copy;
    });
    setError(null);
  };
  const patch = (i: number, p: Partial<Person>) => {
    setPeople((prev) => prev.map((row, k) => (k === i ? { ...row, ...p } : row)));
    setError(null);
  };

  function submit() {
    setError(null);
    const list = people.map((p) => ({ name: p.name.trim(), role: p.role }));
    start(async () => {
      if (signup && !token) {
        const r = await selfRegisterDrifter({
          slug: slug ?? "",
          name: who.name.trim(),
          team: who.team.trim() || undefined,
          car: who.car.trim() || undefined,
          email: who.email.trim() || undefined,
          people: list,
          rulesAck: ack,
        });
        if (!r.ok) { setError(r.error); return; }
        if (r.token) {
          setToken(r.token);
          // this phone remembers it, so reopening the shared link finds the list again
          rememberDrifterLink(r.token, who.name.trim());
        }
        setEmailedTo(r.emailed ? who.email.trim() : null);
      } else {
        const r = await submitDrifterRegistration({ token, people: list, rulesAck: ack });
        if (!r.ok) { setError(r.error); return; }
      }
      setDone(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  if (done) {
    return (
      <div className="card text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full border border-emerald-400/40 bg-emerald-400/10 text-2xl text-emerald-300" aria-hidden>
          &#10003;
        </div>
        <h2 className="display-title mt-4 text-2xl">You&rsquo;re on the list</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-zinc-400">
          Show this screen at the registration desk on event day. Your wristbands will be waiting.
          <span className="mt-1 block text-zinc-500">Ipakita ito sa registration desk sa araw ng event.</span>
        </p>
        <div className="mx-auto mt-5 max-w-sm rounded-xl border border-dashed border-white/20 bg-black/30 p-3">
          <div className="text-[10px] uppercase tracking-widest text-zinc-500">Reference</div>
          <div className="mt-1 font-mono text-2xl font-bold text-cyan-300">{drifterReference(token)}</div>
        </div>
        {signup && siteUrl && token && (
          <div className="mx-auto mt-4 max-w-sm rounded-xl border border-cyan-400/30 bg-cyan-400/5 p-3 text-left">
            <div className="text-xs font-semibold text-cyan-200">Save your personal link</div>
            <p className="mt-1 text-xs text-zinc-400">
              Open it any time to change your list before event day. Keep it to yourself.
              {emailedTo
                ? <> We are also emailing it to <b className="text-zinc-200">{emailedTo}</b>; check Spam if it is not there in a few minutes.</>
                : " This phone will remember it too."}
              <span className="block text-zinc-500">I-save ang link na ito para mabago ang listahan mo.</span>
            </p>
            <div className="mt-2 flex items-center gap-2">
              <input
                readOnly
                className="input min-w-0 flex-1 py-1 font-mono text-xs"
                value={drifterLink(siteUrl, token)}
                onFocus={(e) => e.currentTarget.select()}
                aria-label="Your personal link"
              />
              <button type="button" className="btn-secondary shrink-0 px-3 py-1 text-xs" onClick={() => copyLink(drifterLink(siteUrl, token))}>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        )}
        <div className="mx-auto mt-5 max-w-sm text-left">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            {count} wristband{count === 1 ? "" : "s"} for {shownName}
            {extra > 0 ? ` · ${extra} to pay at the desk` : " · all free"}
          </div>
          <ol className="mt-2 divide-y divide-white/10 rounded-lg border border-white/10 text-sm">
            {people.map((p, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0 truncate"><span className="mr-2 text-xs text-zinc-500 tabular-nums">{i + 1}</span>{p.name}</span>
                <span className="shrink-0 text-xs text-zinc-400">{p.role}</span>
              </li>
            ))}
          </ol>
        </div>
        {signup && siteUrl && token ? (
          <a href={drifterLink(siteUrl, token)} className="btn-secondary mt-5 inline-flex">Edit my list</a>
        ) : (
          <button type="button" className="btn-secondary mt-5" onClick={() => { setDone(false); setAck(false); }}>
            Edit my list
          </button>
        )}
        <p className="mt-2 text-xs text-zinc-500">You can change it any time until the desk hands your wristbands over.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {signup ? (
        /* the drifter says who they are; the desk checks the competitor pass on the day */
        <div className="card space-y-3">
          <div>
            <h2 className="font-semibold">You, the drifter</h2>
            <p className="text-xs text-zinc-500">
              Use the name on your competitor registration. Bring your competitor pass: the desk checks it before handing anything over.
            </p>
          </div>
          <div>
            <label className="label" htmlFor="self-name">Your full name *</label>
            <input id="self-name" className="input mt-1" autoComplete="name" placeholder="e.g. Juan Dela Cruz"
              value={who.name} onChange={(e) => { setWho((w) => ({ ...w, name: e.target.value })); setError(null); }} />
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
            <div>
              <label className="label" htmlFor="self-team">Team</label>
              <input id="self-team" className="input mt-1" placeholder="Leave blank if none"
                value={who.team} onChange={(e) => setWho((w) => ({ ...w, team: e.target.value }))} />
            </div>
            <div>
              <label className="label" htmlFor="self-car">Car #</label>
              <input id="self-car" className="input mt-1" inputMode="numeric" placeholder="e.g. 17"
                value={who.car} onChange={(e) => setWho((w) => ({ ...w, car: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="self-email">Email (recommended)</label>
            <input id="self-email" type="email" className="input mt-1" autoComplete="email" placeholder="name@gmail.com"
              value={who.email} onChange={(e) => { setWho((w) => ({ ...w, email: e.target.value })); setError(null); }} />
            <p className="mt-1 text-xs text-zinc-500">
              We send your personal link here, so you can get back to your list if you close this page.
            </p>
          </div>
        </div>
      ) : (
        /* who this link belongs to; read-only by design */
        <div className="card">
          <div className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-cyan-300">
            <span aria-hidden>&#128274;</span> Your registration
          </div>
          <div className="mt-1.5 text-2xl font-bold">{drifterName}</div>
          <div className="text-sm text-zinc-400">
            {[teamName, carNo ? `Car #${carNo}` : null].filter(Boolean).join(" · ") || "Privateer"}
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            This link is yours alone. If any of this is wrong, contact the organizer instead of submitting.
          </p>
        </div>
      )}

      <div className="card space-y-4">
        <div>
          <span className="label">How many wristbands</span>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <button type="button" className="btn-secondary h-11 w-11 text-xl font-black" disabled={count <= 1} onClick={() => setCount(count - 1)} aria-label="One less wristband">&minus;</button>
            <span className="min-w-[2ch] text-center text-3xl font-black tabular-nums" aria-live="polite">{count}</span>
            <button type="button" className="btn-secondary h-11 w-11 text-xl font-black" disabled={count >= MAX} onClick={() => setCount(count + 1)} aria-label="One more wristband">+</button>
            <span className="text-sm text-zinc-400">
              {extra === 0
                ? <><b className="text-emerald-300">all free</b> &middot; up to {allowance}</>
                : <>{allowance} free &middot; <b className="text-amber-300">{extra} &times; {priceLabel}</b> at the desk</>}
            </span>
          </div>
        </div>

        <div>
          <span className="label">Who is coming with you</span>
          <div className="mt-2 space-y-2">
            {people.map((p, i) => (
              <div key={i} className="grid grid-cols-[1.25rem_minmax(0,1fr)_7rem] items-center gap-2 sm:grid-cols-[1.5rem_minmax(0,1fr)_8rem]">
                <span className="text-right text-xs text-zinc-500 tabular-nums">{i + 1}</span>
                <input
                  id={`person-${i}`}
                  className="input"
                  placeholder="Full name"
                  autoComplete="off"
                  value={p.name}
                  onChange={(e) => patch(i, { name: e.target.value })}
                  aria-label={`Full name of person ${i + 1}`}
                />
                <select
                  id={`role-${i}`}
                  className="input px-2"
                  value={p.role}
                  onChange={(e) => patch(i, { role: e.target.value as DrifterRole })}
                  aria-label={`Role of person ${i + 1}`}
                >
                  {DRIFTER_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <RulesHeading />
        <ol className="mt-3 space-y-3 text-sm">
          {drifterRules(allowance, priceLabel, "drifter").map((rule, i) => (
            <li key={i} className="border-l-2 border-white/15 pl-3">
              <RuleLines lines={rule} />
            </li>
          ))}
        </ol>

        <label className={`mt-4 block cursor-pointer rounded-lg border p-3 transition ${ack ? "border-emerald-500/40 bg-emerald-500/10" : "border-amber-500/40 bg-amber-500/10"}`}>
          <span className="flex items-start gap-2">
            <input
              id="rules-ack"
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-400"
              checked={ack}
              onChange={(e) => { setAck(e.target.checked); setError(null); }}
            />
            <span className={`text-xs font-semibold uppercase tracking-wide ${ack ? "text-emerald-200" : "text-amber-200"}`}>
              {ack ? "Confirmed" : "Your confirmation"}
            </span>
          </span>
          <span className="mt-2 block text-sm sm:pl-6">
            <RuleLines lines={DRIFTER_CONFIRMATION} strong={ack ? "text-emerald-100" : "text-amber-100"} />
          </span>
        </label>
      </div>

      {error && <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</p>}

      <div>
        <button type="button" className="btn-primary h-12 w-full text-base font-bold" disabled={!ready} onClick={submit}>
          {pending ? "Sending…" : submittedAt ? "Update my list" : "Submit my list"}
        </button>
        <p className="mt-2 text-center text-xs text-zinc-500">
          {nameMissing
            ? "Enter your own name as the drifter first."
            : !ack
            ? "Tick the confirmation to continue."
            : blanks > 0
              ? `${blanks} name${blanks === 1 ? " is" : "s are"} still blank.`
              : "Your list goes straight to the registration desk."}
        </p>
      </div>
    </div>
  );
}
