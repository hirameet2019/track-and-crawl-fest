/**
 * SITE DEFAULTS. Admins change the look of the site in Admin > Settings; what
 * they save is stored in the database (app_settings, key "site") and wins over
 * the values here. Anything never saved falls back to this file, so these are
 * the factory settings: they reproduce Meet & Drift 3 exactly.
 *
 * Editable in Admin > Settings: BRAND (except pdf.palette), HERO, THEME (except
 * palette) and NOTES.salesSchedule. The rest is code-only on purpose: LOCALE is
 * used by almost every screen, STAFF.usernameDomain must match the Auth
 * accounts, and the drifter prefix is printed on references already handed out.
 *
 * The event itself and the ticket types live in the events / ticket_types tables,
 * also edited in Admin > Settings. src/config/event.ts holds the business rules.
 * SETUP-NEW-EVENT.md walks through a new event step by step.
 */

/* ------------------------------------------------------------------ brand */

export const BRAND = {
  /** Wordmark shown in the hero, the slim page banner, login, staff nav and 404. */
  logo: "/logo.png",
  /**
   * Artwork washed behind the inner pages (payment, order, login, staff nav).
   * The sales page uses HERO.slides instead.
   */
  backdrop: "/poster.jpg",
  /** Image shown when the site link is shared on Facebook, Messenger, Viber. */
  shareImage: "/poster.jpg",
  /** Added after the event name in the browser tab: "Meet & Drift 3 · Tickets". */
  titleSuffix: "Tickets",
  /**
   * Files the PDF ticket embeds. Paths are from the project root, because the PDF
   * is built on the server from disk; next.config.ts reads them from here so they
   * ship to Vercel. Logo must be PNG, banner must be JPG. If the logo file is
   * missing, the PDF draws the event name as a text wordmark instead.
   */
  pdf: {
    logo: "src/lib/pdf/logo-pdf.png",
    banner: "public/poster-1x.jpg",
    /**
     * Optional hex overrides for the PDF's colour stripe and text wordmark, e.g.
     * `{ pink: "#ff3fd1" }`. Left empty, the PDF keeps the colours it was designed
     * with. The keys are slots, not literal colours: "pink" is the first stripe
     * band and the wordmark's first line, "green" the second line, and so on.
     */
    palette: {} as Partial<Record<"pink" | "pinkDark" | "green" | "cyan" | "teal" | "gold" | "goldDark" | "violet", string>>,
  },
} as const;

/* ------------------------------------------------------------------- hero */

export interface HeroSlide {
  src: string;
  /** What a screen reader announces on this slide's dot. */
  label: string;
  /** CSS background-position. Pick the part that must stay in frame when cropped. */
  position?: string;
  /** "cover" fills and crops; "contain" fits the whole image in, letterboxed. */
  size?: "cover" | "contain";
  /**
   * Muted looping clip played instead of the still. `src` is then its poster
   * frame, which is what shows while it buffers and for anyone who asked for
   * reduced motion. Keep clips short and silent: this is wallpaper, not a player.
   */
  video?: string;
}

export const HERO = {
  /** Artwork behind the sales hero, in order. Drop a file in /public and add a line. */
  slides: [
    { src: "/poster.jpg", label: "event poster", position: "center 35%" },
    // 4.6s cut from the event reel, silent and looping. Taken from the stretch with
    // no burned-in titles, so it does not fight the headline sitting on top of it.
    { src: "/hero-drift.jpg", label: "drift reel", video: "/hero-drift.mp4", position: "center 45%" },
    // Wide sponsor banner: centred, so the logos along the top and bottom edges
    // survive the crop on a tall screen.
    { src: "/poster-sponsors.jpg", label: "sponsors", position: "center center" },
  ] satisfies readonly HeroSlide[] as readonly HeroSlide[],
  /** How long each slide stays before the next fades in. */
  intervalMs: 7000,
  /**
   * Decorative motion layered over the artwork. The smoke and speed streaks suit a
   * motorsport event; switch them off for anything else. The neon glow is generic.
   */
  effects: { glow: true, smoke: true, streaks: true },
} as const;

/* ------------------------------------------------------------------ theme */

/**
 * The brand palette. These drive the page background, the neon buttons, the
 * gradient underlines, the hero glow and the staff screens. Any CSS colour works.
 */
export const THEME = {
  /** Page background behind the hero and the dark staff screens. */
  background: "#0a0a0c",
  /** Top of the hero's fallback gradient, shown while artwork loads. */
  backgroundDeep: "#14061f",
  /** Browser address-bar colour on phones. */
  browserChrome: "#0a0a0a",
  /** The four stops of the signature neon gradient, left to right. */
  neon: {
    pink: "#ff3fd1",
    violet: "#b34cff",
    cyan: "#2fd8ff",
    green: "#6dff5c",
  },
  /**
   * Optional: re-tint a whole Tailwind colour family across the app without editing
   * components. The interface uses `cyan` as its accent in about 90 places, so
   * overriding it here recolours buttons, links and highlights everywhere.
   * Leave empty to keep Tailwind's own colours, which is what Meet & Drift 3 uses.
   *
   *   palette: { cyan: { 300: "#ffb347", 400: "#ff9f1c", 500: "#f08700", ... } }
   */
  palette: {} as Partial<Record<"cyan" | "fuchsia" | "violet", Partial<Record<50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950, string>>>>,
} as const;

/* ----------------------------------------------------------------- locale */

/**
 * Money, dates and phone numbers. TIME_ZONE drives every date shown and every
 * cut-off; UTC_OFFSET must match it. A fixed offset is only right for a zone with
 * no daylight saving, which holds for the Philippines.
 */
export const LOCALE = {
  locale: "en-PH",
  timeZone: "Asia/Manila",
  utcOffset: "+08:00",
  /** ISO 4217 code. Amounts are stored in the smallest unit (centavos). */
  currency: "PHP",
  /** Shown where a currency symbol cannot be drawn, such as the PDF. */
  currencyCode: "PHP",
  /** Short city name used in column headings, e.g. "Time (Manila)". */
  timeZoneLabel: "Manila",
} as const;

/* ------------------------------------------------------------------ staff */

export const STAFF = {
  /**
   * Gate staff sign in with a short username like "walkin1"; the account behind it
   * is walkin1@<this domain> in Supabase Auth. Change it only together with the
   * accounts themselves, or existing logins stop working.
   */
  usernameDomain: "drift.local",
} as const;

/* ---------------------------------------------------- event-specific notes */

/**
 * Notes that describe this particular event's arrangements and are shown to staff.
 * They are not data, so they live here. Set any of them to null for the next event
 * and the note disappears.
 */
export const NOTES = {
  /** Under Admin > Settings, beside the per-label sales cut-offs. */
  salesSchedule:
    "Organizer's schedule: Early Bird and Early Bird Kids close end of Oct 8; VIP Car Display and VIP Pass close end of Oct 4. The passenger included with each VIP Car ticket follows the VIP Pass cut-off." as string | null,
  /** Short prefix on drifter desk references, e.g. MD3-4F2A. */
  drifterReferencePrefix: "MD3",
} as const;
