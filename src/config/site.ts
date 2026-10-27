/**
 * SITE DEFAULTS. Admins change the look of the site in Admin > Settings; what
 * they save is stored in the database (app_settings, key "site") and wins over
 * the values here. Anything never saved falls back to this file, so these are
 * the factory settings: they reproduce Track & Crawl Fest 2026 (forked from the
 * Meet & Drift 3 build).
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
  /**
   * Wordmark shown in the hero, the slim page banner, login, staff nav and 404.
   * Blank sets the event name as a type lockup (SiteLogo) until a transparent PNG
   * of the poster's brush logo is uploaded in Admin > Settings.
   */
  logo: "",
  /**
   * Artwork washed behind the inner pages (payment, order, login, staff nav).
   * The sales page uses HERO.slides instead.
   */
  backdrop: "/tcf/hero-track.jpg",
  /** Image shown when the site link is shared on Facebook, Messenger, Viber. */
  shareImage: "/tcf/share.jpg",
  /** Added after the event name in the browser tab: "Track & Crawl Fest 2026 · Registration". */
  titleSuffix: "Registration",
  /**
   * Files the PDF ticket embeds. Paths are from the project root, because the PDF
   * is built on the server from disk; next.config.ts reads them from here so they
   * ship to Vercel. Logo must be PNG, banner must be JPG. If the logo file is
   * missing, the PDF draws the event name as a text wordmark instead.
   */
  pdf: {
    // No file here yet: the PDF writes the event name as its wordmark until a
    // logo is uploaded in Settings (the Meet & Drift logo must not print on these).
    logo: "src/lib/pdf/logo-event.png",
    banner: "public/tcf/hero-track.jpg",
    /**
     * Optional hex overrides for the PDF's colour stripe and text wordmark, e.g.
     * `{ pink: "#ff3fd1" }`. Left empty, the PDF keeps the colours it was designed
     * with. The keys are slots, not literal colours: "pink" is the first stripe
     * band and the wordmark's first line, "green" the second line, and so on.
     */
    // The poster's red, orange and amber instead of the Meet & Drift neon stripe.
    palette: { pink: "#e8252b", pinkDark: "#a01116", green: "#ff6a1a", cyan: "#ffa21f", teal: "#dd5b02", gold: "#ffa21f", goldDark: "#b73d06", violet: "#c11015" } as Partial<Record<"pink" | "pinkDark" | "green" | "cyan" | "teal" | "gold" | "goldDark" | "violet", string>>,
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
    // The circuit scene from the poster, below its title block, so no baked-in text
    // fights the headline. Swap for the photographer's originals when they arrive.
    { src: "/tcf/hero-track.jpg", label: "Tarlac Circuit Hill at sunset", position: "center 55%" },
    { src: "/tcf/hero-title.jpg", label: "Track & Crawl Fest 2026 poster", position: "center 70%" },
  ] satisfies readonly HeroSlide[] as readonly HeroSlide[],
  /** How long each slide stays before the next fades in. */
  intervalMs: 7000,
  /**
   * Decorative motion layered over the artwork. The smoke and speed streaks suit a
   * motorsport event; switch them off for anything else. The neon glow is generic.
   */
  // Tyre smoke and speed streaks suit a circuit day; the white glow would wash out the sunset.
  effects: { glow: false, smoke: true, streaks: true },
} as const;

/* ------------------------------------------------------------------ theme */

/**
 * The brand palette. These drive the page background, the neon buttons, the
 * gradient underlines, the hero glow and the staff screens. Any CSS colour works.
 */
export const THEME = {
  /** Page background: the poster's night-black, warmed toward ember. */
  background: "#0b0908",
  /** Top of the hero's fallback gradient: the sunset's last ember. */
  backgroundDeep: "#2a1206",
  /** Browser address-bar colour on phones. */
  browserChrome: "#0b0908",
  /**
   * The four accent slots (the names are slots from the first build, not colours):
   * bone white, sunset amber, the poster's CRAWL red, and orange. Buttons run
   * red to orange; underlines run white, amber, red, orange like the brush stroke.
   */
  neon: {
    pink: "#f5efe6",
    violet: "#ffa21f",
    cyan: "#e8252b",
    green: "#ff6a1a",
  },
  /**
   * Re-tints whole Tailwind families across the app. The interface uses `cyan` as
   * its accent in about 90 places, so pointing it at red recolours links, tags,
   * focus and highlights everywhere; fuchsia follows it and violet becomes amber.
   */
  palette: {
    cyan: { 50: "#fff1f1", 100: "#ffdfe0", 200: "#ffc5c6", 300: "#ff9b9d", 400: "#ff6467", 500: "#f8353a", 600: "#e5181e", 700: "#c11015", 800: "#a01116", 900: "#841519", 950: "#480507" },
    fuchsia: { 300: "#ff9b9d", 400: "#ff6467", 500: "#f8353a", 600: "#e5181e" },
    violet: { 50: "#fff8eb", 100: "#ffecc6", 200: "#ffd888", 300: "#ffbe4a", 400: "#ffa21f", 500: "#f98007", 600: "#dd5b02", 700: "#b73d06", 800: "#942f0c", 900: "#7a280d" },
  } as Partial<Record<"cyan" | "fuchsia" | "violet", Partial<Record<50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950, string>>>>,
} as const;

/* ------------------------------------------------------------------- info */

/**
 * The event information block between the hero and the registration form.
 * Date, venue and tagline come from the event row; these fill the rest.
 */
export const INFO = {
  /** When the day ends, "17:00"; blank shows the start time only. */
  endTime: "17:00",
  /** Strip of presenter logos ("Presented by"); blank hides the row. */
  presentedBy: "/tcf/presented-by.png",
  /** Sponsor logo strip; blank hides it. */
  sponsors: "/tcf/sponsors.png",
} as const;

export interface GalleryPhoto {
  src: string;
  /** What the photo shows, for screen readers. */
  alt: string;
  /** CSS object-position. Pick the part that must stay in frame when cropped. */
  position?: string;
}

/**
 * Photos from past events, shown in the information block. The first is the large
 * tile. These are the built-in defaults: admins upload, reorder and remove photos
 * in Admin > Settings > Look, which overrides this list. An empty list hides it.
 */
export const GALLERY = {
  title: "From past events",
  photos: [
    { src: "/tcf/past/mustang-smoke.jpg", alt: "A red Mustang laying tyre smoke on the circuit", position: "60% 60%" },
    { src: "/tcf/past/civic-pits.jpg", alt: "A blue Honda Civic with a GT wing parked by the photobooth", position: "65% 55%" },
    { src: "/tcf/past/gr86-paddock.jpg", alt: "A red Toyota 86 with a carbon hood in the paddock", position: "45% 60%" },
    { src: "/tcf/past/crew-photo.jpg", alt: "Club members posing together at the track", position: "50% 45%" },
    { src: "/tcf/past/crew-shirts.jpg", alt: "Two spectators in matching event shirts watching from the barrier", position: "50% 40%" },
    { src: "/tcf/past/convoy.jpg", alt: "A convoy of club cars rolling through a corner of the circuit", position: "50% 55%" },
  ] satisfies readonly GalleryPhoto[] as readonly GalleryPhoto[],
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
