import Link from "next/link";
import type { EventRow } from "@/lib/supabase/types";

/** Poster placed at public/poster.jpg. A neon gradient shows until the file exists. */
const POSTER_BG =
  "url(/poster.jpg), radial-gradient(1200px 600px at 20% 0%, rgba(255,63,209,0.35), transparent 60%), radial-gradient(900px 500px at 90% 20%, rgba(47,216,255,0.35), transparent 60%), linear-gradient(180deg, #14061f 0%, #0a0a0c 100%)";

function fmtDate(iso: string | null) {
  if (!iso) return { day: "Date TBA", time: "" };
  const d = new Date(iso);
  return {
    day: d.toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }),
    time: d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }),
  };
}

/** Full hero for the sales page. */
export function EventHero({ event, prices }: { event: EventRow; prices: { label: string; price: string }[] }) {
  const { day, time } = fmtDate(event.starts_at);
  return (
    <section className="relative isolate overflow-hidden bg-[#0a0a0c] text-white">
      {/* Landscape crowd-and-cars artwork from the poster, slow zoom/pan */}
      <div
        className="hero-bg absolute inset-0 -z-20 bg-cover bg-[position:center_35%]"
        style={{ backgroundImage: POSTER_BG }}
        aria-hidden
      />
      {/* drifting neon light */}
      <div className="hero-glow-a absolute -left-1/4 -top-1/4 -z-10 h-[70vh] w-[70vw] rounded-full bg-[radial-gradient(closest-side,rgba(255,63,209,0.55),transparent_70%)] mix-blend-screen blur-2xl" aria-hidden />
      <div className="hero-glow-b absolute -right-1/4 top-0 -z-10 h-[60vh] w-[60vw] rounded-full bg-[radial-gradient(closest-side,rgba(47,216,255,0.5),transparent_70%)] mix-blend-screen blur-2xl" aria-hidden />
      {/* tire smoke rolling across the lower half */}
      <div className="hero-smoke absolute bottom-[18%] left-0 -z-10 h-40 w-[45vw] rounded-full bg-white/18 blur-3xl" aria-hidden />
      <div className="hero-smoke hero-smoke-2 absolute bottom-[8%] left-0 -z-10 h-56 w-[55vw] rounded-full bg-white/14 blur-3xl" aria-hidden />
      <div className="hero-smoke hero-smoke-3 absolute bottom-[30%] left-0 -z-10 h-32 w-[35vw] rounded-full bg-fuchsia-200/15 blur-3xl" aria-hidden />
      {/* speed streaks */}
      <div className="hero-streak absolute left-0 top-[22%] -z-10 h-px w-[40vw] bg-gradient-to-r from-transparent via-cyan-200 to-transparent" aria-hidden />
      <div className="hero-streak hero-streak-2 absolute left-0 top-[38%] -z-10 h-[2px] w-[30vw] bg-gradient-to-r from-transparent via-fuchsia-300 to-transparent" aria-hidden />
      <div className="hero-streak hero-streak-3 absolute left-0 top-[55%] -z-10 h-px w-[50vw] bg-gradient-to-r from-transparent via-white to-transparent" aria-hidden />
      {/* darken + fade into the page */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-black/45 via-black/25 to-[#0a0a0c]" aria-hidden />
      <div className="absolute inset-x-0 bottom-0 -z-10 h-64 bg-gradient-to-t from-[#0a0a0c] via-[#0a0a0c]/85 to-transparent" aria-hidden />

      <div className="mx-auto flex min-h-[78vh] max-w-5xl flex-col justify-end px-5 pb-14 pt-24 sm:min-h-[84vh] sm:px-8">
        {event.tagline && (
          <p className="mb-3 inline-flex w-fit items-center gap-2 rounded-full border border-white/20 bg-black/40 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-200 backdrop-blur">
            {event.tagline}
          </p>
        )}
        <h1 className="m-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt={event.name} className="w-full max-w-[680px] drop-shadow-[0_6px_24px_rgba(0,0,0,0.6)]" />
        </h1>

        <div className="mt-6 flex flex-wrap gap-3 text-sm">
          <span className="glass px-4 py-2 font-semibold">{day}{time ? ` · ${time} onwards` : ""}</span>
          {event.venue && <span className="glass px-4 py-2 text-zinc-200">{event.venue}</span>}
        </div>

        <div className="mt-8 flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-400">Admission</div>
            <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1">
              {prices.map((p) => (
                <div key={p.label} className="text-lg font-bold">
                  {p.price} <span className="text-sm font-medium text-zinc-400">{p.label}</span>
                </div>
              ))}
            </div>
          </div>
          <a href="#tickets" className="btn-neon pulse">Get tickets</a>
        </div>
        <a href="#tickets" aria-label="Scroll down to tickets" className="hero-cue mx-auto mt-8 flex w-fit flex-col items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-zinc-400 hover:text-white">
          Scroll
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M6 9l6 6 6-6" /></svg>
        </a>
      </div>
    </section>
  );
}

/** Slim banner for payment / order pages. */
export function EventBanner({ event, backHref = "/", backLabel = "Back to tickets" }: { event: EventRow; backHref?: string; backLabel?: string }) {
  const { day } = fmtDate(event.starts_at);
  return (
    <header className="relative isolate overflow-hidden bg-[#0a0a0c] text-white">
      <div className="absolute -inset-2 -z-20 bg-cover bg-[position:center_45%] opacity-60 blur-[3px]" style={{ backgroundImage: POSTER_BG }} aria-hidden />
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-black/90 via-black/75 to-black/60" aria-hidden />
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-6">
        <div>
          <Link href={backHref} className="text-xs text-zinc-300 hover:underline">&larr; {backLabel}</Link>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt={event.name} className="mt-1 h-16 w-auto sm:h-24" />
          <div className="mt-1 text-xs text-zinc-300">{day}{event.venue ? ` · ${event.venue}` : ""}</div>
        </div>
      </div>
    </header>
  );
}
