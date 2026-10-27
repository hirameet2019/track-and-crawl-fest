"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { recordSignOut } from "@/app/actions/auth";
import { hasRole, homeFor } from "@/lib/roles";
import type { StaffRole } from "@/lib/supabase/types";

type Item = { href: string; label: string; min: StaffRole; icon: keyof typeof ICONS; drifters?: true; system?: true; scan?: true };

// `drifters`: shown only when the event sells drifter family bands (see the staff layout).
// `system`: Numbers, Audit and Settings, only for an admin with system access.
// `scan`: hidden for an account with Scan turned off (staff.can_scan).
const GROUPS: { title: string; items: Item[] }[] = [
  { title: "Overview", items: [{ href: "/admin", label: "Dashboard", min: "staff", icon: "dashboard" }] },
  {
    title: "Sales",
    items: [
      { href: "/admin/verify", label: "Verify", min: "staff", icon: "verify" },
      { href: "/admin/orders", label: "Orders", min: "staff", icon: "orders" },
      { href: "/admin/walkin", label: "Walk-in", min: "gate", icon: "walkin" },
      { href: "/admin/drifters", label: "Drifters", min: "staff", icon: "drifters", drifters: true },
    ],
  },
  { title: "Gate", items: [{ href: "/scan", label: "Scan", min: "scanner", icon: "scan", scan: true }] },
  {
    title: "Admin",
    items: [
      { href: "/admin/reports", label: "Reports", min: "admin", icon: "reports" },
      { href: "/admin/numbers", label: "Numbers", min: "admin", icon: "numbers", system: true },
      { href: "/admin/audit", label: "Audit", min: "admin", icon: "audit", system: true },
      { href: "/admin/settings", label: "Settings", min: "admin", icon: "settings", system: true },
    ],
  },
];

// One stroke family (24px grid, 1.75 stroke, round caps) drawn for this app.
const ICONS = {
  dashboard: <><rect x="3.5" y="3.5" width="7" height="9" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="5" rx="1.5" /><rect x="13.5" y="11.5" width="7" height="9" rx="1.5" /><rect x="3.5" y="15.5" width="7" height="5" rx="1.5" /></>,
  verify: <><path d="M12 3.5l7 3v5.2c0 4.3-3 7.6-7 8.8-4-1.2-7-4.5-7-8.8V6.5z" /><path d="M8.8 12.2l2.2 2.2 4.3-4.6" /></>,
  orders: <><path d="M6 3.5h12v17l-3-1.8-3 1.8-3-1.8-3 1.8z" /><path d="M9 8h6M9 11.5h6M9 15h3.5" /></>,
  walkin: <><path d="M4 8.5a2 2 0 012-2h12a2 2 0 012 2v1.5a2 2 0 000 4V15.5a2 2 0 01-2 2H6a2 2 0 01-2-2V14a2 2 0 000-4z" /><path d="M14.5 6.5v11" strokeDasharray="1.6 2" /></>,
  drifters: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="2.5" /><path d="M12 3.5v6M5.2 16.5l4.7-3M18.8 16.5l-4.7-3" /></>,
  scan: <><path d="M4 8V5.5A1.5 1.5 0 015.5 4H8M16 4h2.5A1.5 1.5 0 0120 5.5V8M20 16v2.5a1.5 1.5 0 01-1.5 1.5H16M8 20H5.5A1.5 1.5 0 014 18.5V16" /><path d="M4 12h16" /></>,
  reports: <><path d="M4 20h16" /><path d="M7 16.5V11M12 16.5V6.5M17 16.5v-4" /></>,
  numbers: <><path d="M9 4L7 20M17 4l-2 16M4.5 9h15M3.5 15h15" /></>,
  audit: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4L6 18M18 18l-1.6-1.6M7.6 7.6L6 6" /></>,
  external: <><path d="M14 4h6v6" /><path d="M20 4l-9 9" /><path d="M18 14v4.5a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 014 18.5v-11A1.5 1.5 0 015.5 6H10" /></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
  close: <><path d="M6 6l12 12M18 6L6 18" /></>,
  signout: <><path d="M14 4h4.5A1.5 1.5 0 0120 5.5v13a1.5 1.5 0 01-1.5 1.5H14" /><path d="M10 16l-4-4 4-4M6 12h10" /></>,
};

function Icon({ name, className = "h-[18px] w-[18px]" }: { name: keyof typeof ICONS; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICONS[name]}
    </svg>
  );
}

export function StaffShell({
  name, role, system, scan, eventName, drifters, logo, children,
}: { name: string; role: StaffRole; system: boolean; scan: boolean; eventName: string; drifters: boolean; logo: string; children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  async function signOut() {
    await recordSignOut().catch(() => {});
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  const groups = GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((l) => hasRole(role, l.min) && (!l.drifters || drifters) && (!l.system || system) && (!l.scan || scan)),
  })).filter((g) => g.items.length);
  const isActive = (href: string) => (href === "/admin" ? path === "/admin" : path.startsWith(href));
  const current = groups.flatMap((g) => g.items).find((l) => isActive(l.href));

  const nav = (
    <nav aria-label="Staff" className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 pb-4">
      {groups.map((g) => (
        <div key={g.title}>
          <div className="px-3 pb-1.5 text-xs font-semibold text-zinc-400">{g.title}</div>
          <ul className="space-y-0.5">
            {g.items.map((l) => {
              const active = isActive(l.href);
              return (
                <li key={l.href}>
                  <Link
                    prefetch={false}
                    href={l.href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setOpen(false)}
                    className={`staff-nav-link ${active ? "is-active" : ""}`}
                  >
                    <Icon name={l.icon} />
                    {l.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  const footer = (
    <div className="border-t border-zinc-200 px-3 py-3">
      <a href="/#tickets" target="_blank" rel="noreferrer" className="staff-nav-link" title="Open the public ticket page in a new tab">
        <Icon name="external" />
        Ticket page
      </a>
      <div className="mt-2 flex items-center gap-3 rounded-xl px-3 py-2">
        <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-zinc-200 text-xs font-bold text-cyan-300 ring-1 ring-inset ring-cyan-300/50">
          {name.trim().slice(0, 1).toUpperCase() || "?"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-zinc-900">{name}</div>
          <div className="text-xs capitalize text-zinc-500">{role}</div>
        </div>
        <button type="button" onClick={signOut} className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900" title="Sign out" aria-label="Sign out">
          <Icon name="signout" />
        </button>
      </div>
    </div>
  );

  const brand = (
    <Link prefetch={false} href={homeFor(role)} className="flex items-center gap-3 px-5 pb-5 pt-5" aria-label={eventName ? `${eventName} staff home` : "Staff home"}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logo} alt={eventName} className="h-10 w-auto max-w-[150px] object-contain" />
      <span className="rounded-md border border-zinc-300 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-500">Staff</span>
    </Link>
  );

  return (
    <div className="lg:grid lg:min-h-screen lg:grid-cols-[256px_minmax(0,1fr)]">
      {/* Desktop: a fixed sidebar */}
      <aside className="staff-sidebar sticky top-0 hidden h-screen flex-col lg:flex">
        {brand}
        {nav}
        {footer}
      </aside>

      {/* Phone and tablet: a top bar with the page name and a drawer */}
      <header className="staff-topbar sticky top-0 z-30 flex items-center gap-3 px-4 py-2.5 lg:hidden">
        <button type="button" onClick={() => setOpen(true)} className="grid h-10 w-10 place-items-center rounded-xl border border-zinc-200 text-zinc-800" aria-label="Open menu" aria-expanded={open}>
          <Icon name="menu" className="h-5 w-5" />
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} alt={eventName} className="h-8 w-auto max-w-[110px] object-contain" />
        <span className="ml-auto truncate text-sm font-semibold text-zinc-800">{current?.label ?? "Staff"}</span>
      </header>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Staff menu">
          <button type="button" className="modal-backdrop absolute inset-0 bg-black/70" onClick={() => setOpen(false)} aria-label="Close menu" />
          <aside className="staff-sidebar staff-drawer absolute inset-y-0 left-0 flex w-[min(85vw,300px)] flex-col">
            <div className="flex items-center justify-between pr-3">
              {brand}
              <button type="button" onClick={() => setOpen(false)} className="grid h-9 w-9 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-100" aria-label="Close menu">
                <Icon name="close" className="h-5 w-5" />
              </button>
            </div>
            {nav}
            {footer}
          </aside>
        </div>
      )}

      <main className="min-w-0">
        <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-10 lg:py-9">{children}</div>
      </main>
    </div>
  );
}
