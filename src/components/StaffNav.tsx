"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { recordSignOut } from "@/app/actions/auth";
import { hasRole, homeFor } from "@/lib/roles";
import type { StaffRole } from "@/lib/supabase/types";
import { neon } from "@/lib/theme";

// `drifters`: shown only when the event sells drifter family bands (see the staff layout).
const LINKS: { href: string; label: string; min: StaffRole; drifters?: true }[] = [
  { href: "/admin", label: "Dashboard", min: "staff" },
  { href: "/admin/verify", label: "Verify", min: "staff" },
  { href: "/admin/orders", label: "Orders", min: "staff" },
  { href: "/admin/walkin", label: "Walk-in", min: "gate" },
  { href: "/admin/drifters", label: "Drifters", min: "staff", drifters: true },
  { href: "/admin/numbers", label: "Numbers", min: "admin" },
  { href: "/admin/reports", label: "Reports", min: "admin" },
  { href: "/admin/audit", label: "Audit", min: "admin" },
  { href: "/admin/settings", label: "Settings", min: "admin" },
  { href: "/scan", label: "Scan", min: "scanner" },
];

export function StaffNav({ name, role, eventName, drifters, logo, backdrop }: { name: string; role: StaffRole; eventName: string; drifters: boolean; logo: string; backdrop: string }) {
  const path = usePathname();
  const router = useRouter();
  async function signOut() {
    await recordSignOut().catch(() => {});
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }
  return (
    <nav className="relative isolate overflow-hidden border-b border-white/10 bg-zinc-950 text-white">
      {/* faint poster wash behind the bar */}
      <div className="absolute inset-0 -z-10 bg-cover bg-[position:center_40%] opacity-25 blur-[2px]" style={{ backgroundImage: `url(${backdrop})` }} aria-hidden />
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-zinc-950 via-zinc-950/90 to-zinc-950/70" aria-hidden />
      {/* Full width: the logo sits in the top-left corner, Tickets and Sign out in the top-right. */}
      <div className="flex w-full flex-wrap items-center gap-x-1 gap-y-2 px-3 py-2 text-sm sm:px-4 xl:px-6">
        <Link prefetch={false} href={homeFor(role)} className="mr-2 flex items-center gap-2 xl:mr-3" aria-label={eventName ? `${eventName} staff home` : "Staff home"}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logo} alt={eventName} className="h-9 w-auto sm:h-11" />
          <span className="hidden rounded border border-white/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-300 xl:inline">Staff</span>
        </Link>
        {LINKS.filter((l) => hasRole(role, l.min) && (!l.drifters || drifters)).map((l) => {
          const active = l.href === "/admin" ? path === "/admin" : path.startsWith(l.href);
          return (
            <Link prefetch={false}
              key={l.href}
              href={l.href}
              style={active ? { boxShadow: `0 0 18px ${neon("cyan", 0.35)}` } : undefined}
              className={`whitespace-nowrap rounded-md px-2 py-1.5 font-medium transition xl:px-3 ${
                active ? "bg-gradient-to-r from-cyan-300 to-green-300 text-zinc-950" : "text-zinc-300 hover:bg-white/10 hover:text-white"
              }`}
            >
              {l.label}
            </Link>
          );
        })}
        <div className="ml-auto flex items-center gap-2">
          <a
            href="/#tickets"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-cyan-300/40 bg-cyan-300/10 px-3 py-1.5 font-medium text-cyan-200 transition hover:bg-cyan-300/20 hover:text-white"
            title="Open the public ticket page in a new tab"
          >
            Tickets <span aria-hidden className="text-[10px] text-cyan-300/70">&#8599;</span>
          </a>
          {/* The name only fits beside nine tabs from laptop width up; otherwise it is on the button's tooltip. */}
          <span className="hidden whitespace-nowrap text-xs text-zinc-400 xl:inline">{name} &middot; {role}</span>
          <button onClick={signOut} title={`Signed in as ${name} (${role})`} className="whitespace-nowrap rounded-md px-3 py-1.5 text-zinc-300 hover:bg-white/10 hover:text-white">Sign out</button>
        </div>
      </div>
      <div className="h-[3px] w-full bg-gradient-to-r from-fuchsia-500 via-violet-500 via-50% to-cyan-400" aria-hidden />
    </nav>
  );
}
