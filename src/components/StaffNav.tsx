"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { StaffRole } from "@/lib/supabase/types";

const LINKS: { href: string; label: string; min: StaffRole }[] = [
  { href: "/admin", label: "Dashboard", min: "staff" },
  { href: "/admin/verify", label: "Verify", min: "staff" },
  { href: "/admin/orders", label: "Orders", min: "staff" },
  { href: "/admin/walkin", label: "Walk-in", min: "staff" },
  { href: "/admin/numbers", label: "Numbers", min: "admin" },
  { href: "/admin/settings", label: "Settings", min: "admin" },
  { href: "/scan", label: "Scan", min: "scanner" },
];
const RANK: Record<StaffRole, number> = { scanner: 1, staff: 2, admin: 3 };

export function StaffNav({ name, role }: { name: string; role: StaffRole }) {
  const path = usePathname();
  const router = useRouter();
  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }
  return (
    <nav className="relative isolate overflow-hidden border-b border-white/10 bg-zinc-950 text-white">
      {/* faint poster wash behind the bar */}
      <div className="absolute inset-0 -z-10 bg-[url(/poster.jpg)] bg-cover bg-[position:center_40%] opacity-25 blur-[2px]" aria-hidden />
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-zinc-950 via-zinc-950/90 to-zinc-950/70" aria-hidden />
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-1 gap-y-2 px-3 py-2 text-sm">
        <Link href={RANK[role] >= RANK.staff ? "/admin" : "/scan"} className="mr-3 flex items-center gap-2" aria-label="Meet & Drift 3 staff home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Meet & Drift 3" className="h-9 w-auto sm:h-11" />
          <span className="hidden rounded border border-white/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-300 md:inline">Staff</span>
        </Link>
        {LINKS.filter((l) => RANK[role] >= RANK[l.min]).map((l) => {
          const active = l.href === "/admin" ? path === "/admin" : path.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded-md px-3 py-1.5 font-medium transition ${
                active ? "bg-gradient-to-r from-cyan-300 to-green-300 text-zinc-950 shadow-[0_0_18px_rgba(47,216,255,0.35)]" : "text-zinc-300 hover:bg-white/10 hover:text-white"
              }`}
            >
              {l.label}
            </Link>
          );
        })}
        <span className="ml-auto hidden text-xs text-zinc-400 sm:inline">{name} &middot; {role}</span>
        <button onClick={signOut} className="rounded-md px-3 py-1.5 text-zinc-300 hover:bg-white/10 hover:text-white">Sign out</button>
      </div>
      <div className="h-[3px] w-full bg-gradient-to-r from-fuchsia-500 via-violet-500 via-50% to-cyan-400" aria-hidden />
    </nav>
  );
}
