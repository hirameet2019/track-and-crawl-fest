"use client";

import { useEffect } from "react";

/**
 * On phones the Settings tabs are a sideways-scrolling strip. Scroll it so the open
 * tab is in view (a later tab like Users & roles would otherwise sit off-screen).
 * Only the strip moves, never the page. Nothing to do on desktop, where it is a column.
 */
export function ActiveTabInView({ navId }: { navId: string }) {
  useEffect(() => {
    const nav = document.getElementById(navId);
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !active || nav.scrollWidth <= nav.clientWidth) return;
    const n = nav.getBoundingClientRect();
    const a = active.getBoundingClientRect();
    nav.scrollLeft += a.left - n.left - (n.width - a.width) / 2;
  });
  return null;
}
