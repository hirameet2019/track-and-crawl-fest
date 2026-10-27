import Link from "next/link";
import { SiteLogo } from "@/components/SiteLogo";
import { LOCALE } from "@/config/site";
import { HeroSlides } from "@/components/HeroSlides";
import { getSiteSettings } from "@/lib/site-settings";
import { heroFallbackGradient, neon } from "@/lib/theme";
import type { EventRow } from "@/lib/supabase/types";

/** The inner-page backdrop over the neon wash, which shows until the file loads. */
const backdropImage = (backdrop: string) => `url(${backdrop}), ${heroFallbackGradient()}`;

function fmtDate(iso: string | null) {
  if (!iso) return { day: "Date TBA", time: "" };
  const d = new Date(iso);
  return {
    day: d.toLocaleDateString(LOCALE.locale, { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: LOCALE.timeZone }),
    time: d.toLocaleTimeString(LOCALE.locale, { hour: "numeric", minute: "2-digit", timeZone: LOCALE.timeZone }),
  };
}

/** Full hero for the sales page. */
export async function EventHero({ event, prices }: { event: EventRow; prices: { label: string; price: string }[] }) {
  const { day, time } = fmtDate(event.starts_at);
  const site = await getSiteSettings();
  const fx = site.hero.effects;
  return (
    <section className="relative isolate overflow-hidden bg-brand text-white">
      {/* Slides from Admin > Settings, cross-fading, each with the same slow zoom/pan */}
      <div className="absolute inset-0 -z-30" style={{ backgroundImage: heroFallbackGradient() }} aria-hidden />
      <HeroSlides slides={site.hero.slides} intervalMs={site.hero.intervalMs} />
      {fx.glow && (
        <>
          {/* drifting neon light, in the brand's two lead colours */}
          <div
            className="hero-glow-a absolute -left-1/4 -top-1/4 -z-10 h-[70vh] w-[70vw] rounded-full mix-blend-screen blur-2xl"
            style={{ backgroundImage: `radial-gradient(closest-side, ${neon("pink", 0.55)}, transparent 70%)` }}
            aria-hidden
          />
          <div
            className="hero-glow-b absolute -right-1/4 top-0 -z-10 h-[60vh] w-[60vw] rounded-full mix-blend-screen blur-2xl"
            style={{ backgroundImage: `radial-gradient(closest-side, ${neon("cyan", 0.5)}, transparent 70%)` }}
            aria-hidden
          />
        </>
      )}
      {fx.smoke && (
        <>
          {/* tyre smoke rolling across the lower half */}
          <div className="hero-smoke absolute bottom-[18%] left-0 -z-10 h-40 w-[45vw] rounded-full bg-white/18 blur-3xl" aria-hidden />
          <div className="hero-smoke hero-smoke-2 absolute bottom-[8%] left-0 -z-10 h-56 w-[55vw] rounded-full bg-white/14 blur-3xl" aria-hidden />
          <div className="hero-smoke hero-smoke-3 absolute bottom-[30%] left-0 -z-10 h-32 w-[35vw] rounded-full bg-fuchsia-200/15 blur-3xl" aria-hidden />
        </>
      )}
      {fx.streaks && (
        <>
          {/* speed streaks */}
          <div className="hero-streak absolute left-0 top-[22%] -z-10 h-px w-[40vw] bg-gradient-to-r from-transparent via-cyan-200 to-transparent" aria-hidden />
          <div className="hero-streak hero-streak-2 absolute left-0 top-[38%] -z-10 h-[2px] w-[30vw] bg-gradient-to-r from-transparent via-fuchsia-300 to-transparent" aria-hidden />
          <div className="hero-streak hero-streak-3 absolute left-0 top-[55%] -z-10 h-px w-[50vw] bg-gradient-to-r from-transparent via-white to-transparent" aria-hidden />
        </>
      )}
      {/* darken + fade into the page */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-black/45 via-black/25 to-brand" aria-hidden />
      <div className="absolute inset-x-0 bottom-0 -z-10 h-64 bg-gradient-to-t from-brand via-brand/85 to-transparent" aria-hidden />

      <div className="mx-auto flex min-h-[78vh] max-w-5xl flex-col justify-end px-5 pb-14 pt-24 sm:min-h-[84vh] sm:px-8">
        <h1 className="m-0">
          <SiteLogo src={site.logo} name={event.name} size="xl" className="w-full max-w-[680px] drop-shadow-[0_6px_24px_rgba(0,0,0,0.6)]" />
        </h1>

        <div className="mt-6 flex flex-wrap gap-3 text-sm">
          <span className="glass px-4 py-2 font-semibold">{day}{time ? ` · ${time} onwards` : ""}</span>
          {event.venue && <span className="glass px-4 py-2 text-zinc-200">{event.venue}</span>}
          {event.tagline && <span className="glass px-4 py-2 text-cyan-200">{event.tagline}</span>}
        </div>

        <div className="mt-8 flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="info-fact-label">Registration</div>
            <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1">
              {prices.map((p) => (
                <div key={p.label} className="text-lg font-bold">
                  {p.price} <span className="text-sm font-medium text-zinc-400">{p.label}</span>
                </div>
              ))}
            </div>
          </div>
          <a href="#tickets" className="btn-neon pulse">Register now</a>
        </div>
        <a href="#info" aria-label="Scroll down to the event details" className="hero-cue mx-auto mt-8 flex w-fit flex-col items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-zinc-400 hover:text-white">
          Scroll
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M6 9l6 6 6-6" /></svg>
        </a>
      </div>
    </section>
  );
}

/** Slim banner for payment / order pages. */
export async function EventBanner({ event, backHref = "/", backLabel = "Back to registration" }: { event: EventRow; backHref?: string; backLabel?: string }) {
  const { day } = fmtDate(event.starts_at);
  const site = await getSiteSettings();
  return (
    <header className="relative isolate overflow-hidden bg-brand text-white">
      <div className="absolute -inset-2 -z-20 bg-cover bg-[position:center_45%] opacity-60 blur-[3px]" style={{ backgroundImage: backdropImage(site.backdrop) }} aria-hidden />
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-black/90 via-black/75 to-black/60" aria-hidden />
      {/* Full width, so the logo sits at the left edge like any site header rather than
          floating beside a narrower page column. */}
      <div className="flex w-full items-center justify-between gap-4 px-4 py-6 sm:px-6">
        <div>
          <Link href={backHref} className="text-xs text-zinc-300 hover:underline">&larr; {backLabel}</Link>
          <SiteLogo src={site.logo} name={event.name} size="sm" className="mt-1 h-16 w-auto sm:h-24" />
          <div className="mt-1 text-xs text-zinc-300">{day}{event.venue ? ` · ${event.venue}` : ""}</div>
        </div>
      </div>
    </header>
  );
}
