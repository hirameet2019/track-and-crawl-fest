import Link from "next/link";
import { SiteLogo } from "@/components/SiteLogo";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/LoginForm";
import { LOCALE } from "@/config/site";
import { getStaff } from "@/lib/auth";
import { homeFor } from "@/lib/roles";
import { getActiveEvent } from "@/lib/queries";
import { getSiteSettings } from "@/lib/site-settings";
import { getRules } from "@/lib/rules";
import { siteText } from "@/lib/site-text";

export const dynamic = "force-dynamic";

/**
 * Staff sign-in. A poster panel (backdrop, event lockup, date and venue) beside the
 * form on desktop; on phones the panel shrinks to a banner above the form so the
 * fields stay within thumb reach.
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reason?: string; who?: string }> }) {
  const { next, reason, who } = await searchParams;
  const session = await getStaff();
  // A role that opens nothing stays here with the not-staff note, rather than
  // bouncing between pages it cannot open.
  const home = session && homeFor(session.permissions);
  if (home) redirect(next && next.startsWith("/") ? next : home);
  const notStaff = reason === "not_staff";
  const [event, site, rules] = await Promise.all([getActiveEvent(), getSiteSettings(), getRules()]);
  const tx = siteText(rules.text);
  const day = event?.starts_at
    ? new Date(event.starts_at).toLocaleDateString(LOCALE.locale, { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: LOCALE.timeZone })
    : null;

  return (
    <main className="relative isolate grid flex-1 bg-brand text-white lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <Link href="/" className="absolute left-4 top-4 z-10 inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-black/45 px-3 py-1.5 text-sm text-zinc-200 backdrop-blur-sm transition hover:bg-white/10 hover:text-white sm:left-6 sm:top-6">
        <span aria-hidden>&larr;</span> {tx("nav.back")}
      </Link>

      {/* ---------------------------------------------------------- poster */}
      <section className="login-poster relative isolate flex min-h-[17rem] flex-col justify-end overflow-hidden px-6 pb-8 pt-20 sm:px-10 lg:min-h-full lg:px-14 lg:pb-16">
        <div className="absolute inset-0 -z-20 bg-cover bg-[position:center_45%]" style={{ backgroundImage: `url(${site.backdrop})` }} aria-hidden />
        <div className="login-poster-shade absolute inset-0 -z-10" aria-hidden />
        <SiteLogo src={site.logo} name={event?.name ?? ""} size="xl" className="login-logo max-w-full self-start" />
        {(day || event?.venue) && (
          <div className="mt-5 flex flex-wrap gap-2 text-sm">
            {day && <span className="glass px-3.5 py-1.5 font-semibold text-white">{day}</span>}
            {event?.venue && <span className="glass px-3.5 py-1.5 text-zinc-200">{event.venue}</span>}
          </div>
        )}
        <div className="checker mt-7 hidden w-full max-w-md lg:block" aria-hidden />
      </section>

      {/* ---------------------------------------------------------- form */}
      <section className="flex items-start justify-center px-4 pb-14 pt-8 sm:px-8 lg:items-center lg:px-14 lg:py-16">
        <div className="w-full max-w-sm">
          {tx("login.kicker") && (
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-zinc-400">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--neon-cyan)]" aria-hidden />
              {tx("login.kicker")}
            </p>
          )}
          <h1 className="display-title mt-2 text-[2.6rem] leading-none sm:text-5xl">{tx("login.title")}</h1>
          {tx("login.intro") && <p className="mt-3 text-sm text-zinc-300">{tx("login.intro")}</p>}
          {notStaff && (
            <div className="mt-6 rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-200">
              <b>{who || "This account"}</b> can sign in, but it is not on the staff list yet. Ask an administrator to add it in the
              <code className="mx-1 rounded bg-black/40 px-1">staff</code>table with a role (admin, staff, gate, or scanner), then sign in again.
            </div>
          )}
          <div className="dark-zone mt-8">
            <LoginForm next={next} signedOutFirst={notStaff} />
          </div>
        </div>
      </section>
    </main>
  );
}
