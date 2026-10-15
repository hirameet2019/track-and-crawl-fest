import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/LoginForm";
import { getStaff } from "@/lib/auth";
import { homeFor, roleRank } from "@/lib/roles";
import { getActiveEvent } from "@/lib/queries";
import { getSiteSettings } from "@/lib/site-settings";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reason?: string; who?: string }> }) {
  const { next, reason, who } = await searchParams;
  const session = await getStaff();
  // A role this code does not know stays here with the not-staff note, rather than
  // bouncing between pages it cannot open.
  if (session && roleRank(session.staff.role) > 0) redirect(next && next.startsWith("/") ? next : homeFor(session.staff.role));
  const notStaff = reason === "not_staff";
  const [event, site] = await Promise.all([getActiveEvent(), getSiteSettings()]);

  return (
    <main className="relative isolate flex flex-1 flex-col items-center justify-center overflow-hidden bg-brand px-4 py-12 text-white">
      <div className="absolute inset-0 -z-20 bg-cover bg-[position:center_40%] opacity-50" style={{ backgroundImage: `url(${site.backdrop})` }} aria-hidden />
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-black/70 via-black/60 to-brand" aria-hidden />
      <Link href="/" className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-black/40 px-3 py-1.5 text-sm text-zinc-200 backdrop-blur-sm transition hover:bg-white/10 hover:text-white sm:left-6 sm:top-6">
        <span aria-hidden>&larr;</span> Back to tickets
      </Link>
      <div className="w-full max-w-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={site.logo} alt={event?.name ?? ""} className="mx-auto mb-6 w-64 drop-shadow-[0_6px_24px_rgba(0,0,0,0.7)]" />
        <h1 className="display-title text-center text-2xl">Staff login</h1>
        <p className="mb-6 text-center text-sm text-zinc-300">For organizer staff, verifiers, and gate scanners.</p>
        {notStaff && (
          <div className="mb-4 rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-200">
            <b>{who || "This account"}</b> can sign in, but it is not on the staff list yet. Ask an administrator to add it in the
            <code className="mx-1 rounded bg-black/40 px-1">staff</code>table with a role (admin, staff, gate, or scanner), then sign in again.
          </div>
        )}
        <div className="dark-zone">
          <LoginForm next={next} signedOutFirst={notStaff} />
        </div>
      </div>
    </main>
  );
}
