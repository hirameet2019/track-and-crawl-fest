"use client";

import { useEffect, useRef, type ElementType, type ReactNode } from "react";

/**
 * Scroll-reveal wrapper. Children start hidden (see `.reveal` in globals.css) and
 * animate in the first time they enter the viewport. `delay` staggers siblings.
 * With prefers-reduced-motion the CSS shows everything immediately.
 */
export function Reveal({
  children,
  delay = 0,
  from = "up",
  className = "",
  as: Tag = "div",
  once = true,
}: {
  children: ReactNode;
  delay?: number;
  from?: "up" | "left" | "right" | "zoom";
  className?: string;
  as?: ElementType;
  once?: boolean;
}) {
  const ref = useRef<HTMLElement | null>(null);

  // Toggle the class on the element directly: no React state, so there is no
  // re-render and no setState-in-effect, and the first paint stays hidden.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      el.classList.add("in");
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            (e.target as HTMLElement).classList.add("in");
            if (once) io.unobserve(e.target);
          } else if (!once) {
            (e.target as HTMLElement).classList.remove("in");
          }
        }
      },
      { threshold: 0.18, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [once]);

  return (
    <Tag ref={ref} className={`reveal reveal-${from} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </Tag>
  );
}
