"use client";

import { useEffect, useLayoutEffect, useRef, type ElementType, type ReactNode } from "react";

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
 *
 * React rewrites the whole class attribute whenever the className prop changes
 * (a ticket line turning "is-picked" when its quantity goes up), which drops the
 * two classes and would leave an already revealed element at opacity 0 for good.
 * So they are also kept in a ref and put back after every render, before paint.
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
  const state = useRef({ in: false, settled: false });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.classList.toggle("in", state.current.in);
    el.classList.toggle("settled", state.current.settled);
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    let settleTimer: number | undefined;
    const mark = (cls: "in" | "settled", on: boolean) => {
      state.current[cls] = on;
      el.classList.toggle(cls, on);
    };

    const show = () => {
      mark("in", true);
      if (reduced) {
        mark("settled", true);
        return;
      }
      // Fallback in case transitionend never fires (tab hidden, transition
      // cancelled): the reveal + stagger delay never exceed ~1.5s.
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => mark("settled", true), 1500 + delay);
    };
    const hide = () => {
      window.clearTimeout(settleTimer);
      mark("in", false);
      mark("settled", false);
    };
    const onEnd = (ev: TransitionEvent) => {
      if (ev.target === el && ev.propertyName === "opacity" && state.current.in) {
        window.clearTimeout(settleTimer);
        mark("settled", true);
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
