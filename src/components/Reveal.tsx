"use client";

import { useEffect, useRef, type ElementType, type ReactNode } from "react";

/**
 * Scroll-reveal wrapper. Children start hidden (see `.reveal` in globals.css) and
 * fade/slide in the first time they enter the viewport. `delay` staggers siblings.
 *
 * Two classes are toggled on the element directly (no React state, so no
 * re-render and the first paint stays hidden):
 *   .in       the reveal transition is running / done
 *   .settled  the transition has finished; CSS uses this to hand the element
 *             over to its normal interaction transitions (e.g. hover lift)
 *
 * With prefers-reduced-motion the CSS shows everything immediately, so both
 * classes are added at once.
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

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    let settleTimer: number | undefined;

    const show = () => {
      el.classList.add("in");
      if (reduced) {
        el.classList.add("settled");
        return;
      }
      // Fallback in case transitionend never fires (tab hidden, transition
      // cancelled): the reveal + stagger delay never exceed ~1.5s.
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => el.classList.add("settled"), 1500 + delay);
    };
    const hide = () => {
      window.clearTimeout(settleTimer);
      el.classList.remove("in", "settled");
    };
    const onEnd = (ev: TransitionEvent) => {
      if (ev.target === el && ev.propertyName === "opacity" && el.classList.contains("in")) {
        window.clearTimeout(settleTimer);
        el.classList.add("settled");
      }
    };
    el.addEventListener("transitionend", onEnd);

    if (typeof IntersectionObserver === "undefined") {
      show();
      return () => el.removeEventListener("transitionend", onEnd);
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            show();
            if (once) io.unobserve(e.target);
          } else if (!once) {
            hide();
          }
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -6% 0px" },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      el.removeEventListener("transitionend", onEnd);
      window.clearTimeout(settleTimer);
    };
  }, [once, delay]);

  return (
    <Tag ref={ref} className={`reveal reveal-${from} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </Tag>
  );
}
