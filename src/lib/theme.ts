import { THEME } from "@/config/site";
import type { SiteSettings } from "@/lib/site-settings";

/**
 * The colours come from Admin > Settings at request time, so components never
 * read them directly: the root layout writes them once as CSS variables
 * (themeCss) and everything else refers to the variables. That keeps this file
 * safe to import from client components.
 */

type Neon = "pink" | "violet" | "cyan" | "green";

/**
 * A neon colour at an opacity, e.g. neon("pink", 0.55). color-mix with
 * transparent is the same colour as rgba(r,g,b,0.55), but it follows the
 * variable, so a colour saved in Settings reaches every glow and shadow.
 */
export const neon = (name: Neon, a: number): string =>
  `color-mix(in srgb, var(--neon-${name}) ${Math.round(a * 100)}%, transparent)`;

/** The neon wash behind a slide while it loads, and behind the slim page banner. */
export const heroFallbackGradient = (): string =>
  [
    `radial-gradient(1200px 600px at 20% 0%, ${neon("pink", 0.35)}, transparent 60%)`,
    `radial-gradient(900px 500px at 90% 20%, ${neon("cyan", 0.35)}, transparent 60%)`,
    `linear-gradient(180deg, var(--brand-bg-deep) 0%, var(--brand-bg) 100%)`,
  ].join(", ");

/**
 * CSS custom properties for the brand palette, rendered once in the root layout.
 *
 * The optional palette override (THEME.palette in site.ts, code-only) redefines
 * Tailwind's own `--color-<family>-<shade>` variables. Tailwind 4 declares those
 * inside `@layer theme` and this block is not layered, so it wins: every
 * `text-cyan-300` picks up the new colour without a component changing.
 */
export function themeCss(theme: SiteSettings["theme"]): string {
  const vars: string[] = [
    `--brand-bg:${theme.background}`,
    `--brand-bg-deep:${theme.backgroundDeep}`,
    `--neon-pink:${theme.neon.pink}`,
    `--neon-violet:${theme.neon.violet}`,
    `--neon-cyan:${theme.neon.cyan}`,
    `--neon-green:${theme.neon.green}`,
  ];
  for (const [family, shades] of Object.entries(THEME.palette)) {
    for (const [shade, value] of Object.entries(shades ?? {})) {
      if (value) vars.push(`--color-${family}-${shade}:${value}`);
    }
  }
  return `:root{${vars.join(";")}}`;
}
