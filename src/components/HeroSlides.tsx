"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { HeroSlide } from "@/config/event";

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/**
 * Cross-fading background for the sales hero: stills and short silent clips.
 * The artwork is decoration, so the layers are hidden from assistive tech; the
 * dots are the only part a reader needs, and they exist so the deck is still
 * reachable when the slideshow is not moving (someone who asked for reduced
 * motion, or who wants to stop on one).
 */
export function HeroSlides({ slides, intervalMs = 7000 }: { slides: readonly HeroSlide[]; intervalMs?: number }) {
  const [current, setCurrent] = useState(0);
  // Auto-advance stops for good once someone picks a slide themselves, so the
  // one they wanted to look at does not slide away under them.
  const [taken, setTaken] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (slides.length < 2 || taken || prefersReducedMotion()) return;
    const id = setInterval(() => setCurrent((n) => (n + 1) % slides.length), intervalMs);
    return () => clearInterval(id);
  }, [slides.length, intervalMs, taken]);

  /**
   * Only the slide on screen plays. A clip left running behind a hidden layer
   * burns battery for nothing, and starting from the top each time reads better.
   * The elements are found in the DOM rather than collected through a ref array,
   * which only the video slides would fill and which is easy to leave stale.
   */
  const syncPlayback = useCallback(() => {
    const vids = root.current?.querySelectorAll<HTMLVideoElement>("video[data-slide]");
    vids?.forEach((v) => {
      const mine = Number(v.dataset.slide) === current;
      if (mine && !prefersReducedMotion() && !document.hidden) {
        v.play().catch(() => {}); // refused (autoplay policy): the poster frame stands in
      } else if (!mine) {
        v.pause();
        v.currentTime = 0;
      }
    });
  }, [current]);

  useEffect(() => {
    syncPlayback();
    // A clip whose turn came up while the tab was in the background never got to
    // start, so try again when the page comes back rather than leaving a still.
    document.addEventListener("visibilitychange", syncPlayback);
    return () => document.removeEventListener("visibilitychange", syncPlayback);
  }, [syncPlayback]);

  const pick = useCallback((i: number) => {
    setTaken(true);
    setCurrent(i);
  }, []);

  return (
    <>
      <div ref={root} className="absolute inset-0 -z-20 overflow-hidden" aria-hidden>
        {slides.map((s, i) => (
          <div
            key={s.src}
            className="hero-bg absolute inset-0 transition-opacity duration-1000 ease-in-out"
            style={{
              opacity: i === current ? 1 : 0,
              ...(s.video
                ? {}
                : {
                    backgroundImage: `url(${s.src})`,
                    backgroundSize: s.size ?? "cover",
                    backgroundPosition: s.position ?? "center 35%",
                    backgroundRepeat: "no-repeat",
                  }),
            }}
          >
            {s.video && (
              <video
                data-slide={i}
                className="h-full w-full"
                style={{ objectFit: s.size ?? "cover", objectPosition: s.position ?? "center 35%" }}
                src={s.video}
                poster={s.src}
                muted
                loop
                playsInline
                preload="metadata"
                tabIndex={-1}
              />
            )}
          </div>
        ))}
      </div>

      {slides.length > 1 && (
        <div className="absolute bottom-5 right-5 z-10 flex gap-2 sm:bottom-6 sm:right-8">
          {slides.map((s, i) => (
            <button
              key={s.src}
              type="button"
              onClick={() => pick(i)}
              aria-label={`Show ${s.label}`}
              aria-current={i === current}
              className={`h-2.5 rounded-full border border-white/50 transition-all ${
                i === current ? "w-7 bg-white" : "w-2.5 bg-white/25 hover:bg-white/60"
              }`}
            />
          ))}
        </div>
      )}
    </>
  );
}
