"use client";

import { useEffect, useState, useTransition } from "react";
import { resendDrifterLink } from "@/app/actions/drifter-entries";

/**
 * Getting a drifter back to their personal link after they close the page.
 *
 * Most people reopen whatever link they still have, which is usually the shared
 * sign-up link. So the phone remembers the personal links it has seen, and the
 * sign-up page offers them back. Nothing sensitive is stored beyond what the
 * drifter already holds: their own link and name, on their own device.
 */

const KEY = "md3-drifter-links";
type Saved = { token: string; name: string };

function read(): Saved[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as Saved[]) : [];
    return Array.isArray(list) ? list.filter((s) => s && typeof s.token === "string" && typeof s.name === "string") : [];
  } catch {
    return [];
  }
}

/** Remember a personal link on this device; called wherever the drifter sees it. */
export function rememberDrifterLink(token: string, name: string) {
  try {
    const next = [{ token, name }, ...read().filter((s) => s.token !== token)].slice(0, 5);
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // private mode or blocked storage: the email and the organizer are the fallbacks
  }
}

/** Drop on the personal-link page so the phone remembers it. Renders nothing. */
export function RememberThisLink({ token, name }: { token: string; name: string }) {
  useEffect(() => { rememberDrifterLink(token, name); }, [token, name]);
  return null;
}

/** On the shared sign-up page: "welcome back" for drifters this phone already knows. */
export function RememberedDrifterLinks() {
  const [saved, setSaved] = useState<Saved[]>([]);
  // Read after mount so the server render and the first client render match.
  useEffect(() => {
    const t = setTimeout(() => setSaved(read()), 0);
    return () => clearTimeout(t);
  }, []);
  if (saved.length === 0) return null;
  return (
    <div className="card mb-5 border-cyan-400/40">
      <div className="text-sm font-semibold text-cyan-100">Already signed up on this phone?</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {saved.map((s) => (
          <a key={s.token} href={`/d/${s.token}`} className="btn-primary px-3 py-1.5 text-sm">
            Open {s.name}&rsquo;s list
          </a>
        ))}
      </div>
      <p className="mt-2 text-xs text-zinc-500">Nakapag-sign up ka na? Buksan ang listahan mo dito.</p>
    </div>
  );
}

/** "Lost your link?": resend to the email given at sign-up, never shown on screen. */
export function LostDrifterLink() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="mt-6 text-center text-sm">
      {!open ? (
        <button type="button" className="text-cyan-300 hover:underline" onClick={() => setOpen(true)}>
          Lost your link? &middot; Nawala ang link mo?
        </button>
      ) : (
        <form
          className="card mx-auto max-w-md space-y-3 text-left"
          onSubmit={(e) => {
            e.preventDefault();
            setMsg(null);
            start(async () => {
              const r = await resendDrifterLink({ email });
              setMsg(r.ok ? { ok: true, text: r.message ?? "Sent." } : { ok: false, text: r.error });
            });
          }}
        >
          <div>
            <div className="font-semibold">Get your link again</div>
            <p className="text-xs text-zinc-500">
              Enter the email you gave when you signed up and we will send your personal link there.
              No email on your sign-up? Ask the organizer; they can send it to you.
            </p>
          </div>
          <input
            id="lost-link-email"
            type="email"
            className="input"
            autoComplete="email"
            placeholder="name@gmail.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-label="Email you signed up with"
          />
          <button className="btn-primary w-full" disabled={pending || email.trim().length < 5}>{pending ? "Sending…" : "Email me my link"}</button>
          {msg && <p className={`text-xs ${msg.ok ? "text-emerald-300" : "text-rose-300"}`}>{msg.text}</p>}
        </form>
      )}
    </div>
  );
}
