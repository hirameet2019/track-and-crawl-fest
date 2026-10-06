import { cache } from "react";
import { z } from "zod";
import { BRAND, HERO, NOTES, THEME, type HeroSlide } from "@/config/site";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The look of the site as edited in Admin > Settings. Stored as one JSON value in
 * app_settings under KEY; anything missing or invalid there falls back to the
 * defaults in src/config/site.ts, so an empty table means "exactly as shipped".
 */
export interface SiteSettings {
  titleSuffix: string;
  logo: string;
  backdrop: string;
  shareImage: string;
  /** Uploaded file URL, or null for the built-in file (BRAND.pdf.logo). */
  pdfLogo: string | null;
  /** Uploaded file URL, or null for the built-in file (BRAND.pdf.banner). */
  pdfBanner: string | null;
  /** PDF stripe and text-logo colours; a missing slot keeps the built-in colour. */
  pdfPalette: Partial<Record<PdfSlot, string>>;
  hero: {
    slides: HeroSlide[];
    intervalMs: number;
    effects: { glow: boolean; smoke: boolean; streaks: boolean };
  };
  theme: {
    background: string;
    backgroundDeep: string;
    browserChrome: string;
    neon: { pink: string; violet: string; cyan: string; green: string };
  };
  salesScheduleNote: string | null;
}

const KEY = "site";

/** Colour slots on the PDF ticket (see ticket-pdf.ts). */
export const PDF_SLOTS = ["pink", "violet", "cyan", "green", "pinkDark", "teal", "gold", "goldDark"] as const;
export type PdfSlot = (typeof PDF_SLOTS)[number];

export const SITE_DEFAULTS: SiteSettings = {
  titleSuffix: BRAND.titleSuffix,
  logo: BRAND.logo,
  backdrop: BRAND.backdrop,
  shareImage: BRAND.shareImage,
  pdfLogo: null,
  pdfBanner: null,
  pdfPalette: {},
  hero: {
    slides: HERO.slides.map((s) => ({ ...s })),
    intervalMs: HERO.intervalMs,
    effects: { ...HERO.effects },
  },
  theme: {
    background: THEME.background,
    backgroundDeep: THEME.backgroundDeep,
    browserChrome: THEME.browserChrome,
    neon: { ...THEME.neon },
  },
  salesScheduleNote: NOTES.salesSchedule,
};

/* ------------------------------------------------------------- validation */

const hex = z.string().trim().regex(/^#[0-9a-f]{6}$/i, "Colours must be 6-digit hex, e.g. #ff3fd1");
/** A site path ("/poster.jpg") or an https URL (Supabase Storage upload). */
const asset = z
  .string()
  .trim()
  .max(500)
  .refine((v) => /^\/[^/]/.test(v) || /^https:\/\//.test(v), "Images must be a /public path or an uploaded https URL");

const slide = z.object({
  src: asset,
  label: z.string().trim().min(1, "Every slide needs a short label").max(60),
  position: z.string().trim().max(40).regex(/^[a-z0-9%. -]*$/i, "Focus point looks wrong").optional(),
  size: z.enum(["cover", "contain"]).optional(),
  video: asset.optional(),
});

export const siteSettingsSchema = z.object({
  titleSuffix: z.string().trim().max(40),
  logo: asset,
  backdrop: asset,
  shareImage: asset,
  pdfLogo: asset.nullable(),
  pdfBanner: asset.nullable(),
  pdfPalette: z.partialRecord(z.enum(PDF_SLOTS), hex),
  hero: z.object({
    slides: z.array(slide).min(1, "Keep at least one slide").max(8, "At most 8 slides"),
    intervalMs: z.number().int().min(3000, "At least 3 seconds per slide").max(30000, "At most 30 seconds per slide"),
    effects: z.object({ glow: z.boolean(), smoke: z.boolean(), streaks: z.boolean() }),
  }),
  theme: z.object({
    background: hex,
    backgroundDeep: hex,
    browserChrome: hex,
    neon: z.object({ pink: hex, violet: hex, cyan: hex, green: hex }),
  }),
  salesScheduleNote: z.string().trim().max(600).nullable(),
});

/**
 * Lay the stored value over the defaults one section at a time, so a bad or
 * partial value in one place never blanks the whole site.
 */
export function mergeSiteSettings(stored: unknown): SiteSettings {
  const s = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;
  const pick = <T,>(schema: z.ZodType<T>, value: unknown, fallback: T): T => {
    const r = schema.safeParse(value);
    return r.success ? r.data : fallback;
  };
  const shape = siteSettingsSchema.shape;
  const hero = (s.hero ?? {}) as Record<string, unknown>;
  const theme = (s.theme ?? {}) as Record<string, unknown>;
  const d = SITE_DEFAULTS;
  return {
    titleSuffix: pick(shape.titleSuffix, s.titleSuffix, d.titleSuffix),
    logo: pick(shape.logo, s.logo, d.logo),
    backdrop: pick(shape.backdrop, s.backdrop, d.backdrop),
    shareImage: pick(shape.shareImage, s.shareImage, d.shareImage),
    pdfLogo: pick(shape.pdfLogo, s.pdfLogo, d.pdfLogo),
    pdfBanner: pick(shape.pdfBanner, s.pdfBanner, d.pdfBanner),
    pdfPalette: pick(shape.pdfPalette, s.pdfPalette, d.pdfPalette),
    hero: {
      slides: pick(shape.hero.shape.slides, hero.slides, d.hero.slides),
      intervalMs: pick(shape.hero.shape.intervalMs, hero.intervalMs, d.hero.intervalMs),
      effects: pick(shape.hero.shape.effects, hero.effects, d.hero.effects),
    },
    theme: {
      background: pick(hex, theme.background, d.theme.background),
      backgroundDeep: pick(hex, theme.backgroundDeep, d.theme.backgroundDeep),
      browserChrome: pick(hex, theme.browserChrome, d.theme.browserChrome),
      neon: pick(shape.theme.shape.neon, theme.neon, d.theme.neon),
    },
    salesScheduleNote: "salesScheduleNote" in s ? pick(shape.salesScheduleNote, s.salesScheduleNote, d.salesScheduleNote) : d.salesScheduleNote,
  };
}

/* ------------------------------------------------------------------ store */

/**
 * Effective site settings. Per request (React cache), so the layout, the page and
 * its metadata share one read. Never throws: if the read fails the site renders
 * with the defaults rather than erroring.
 */
export const getSiteSettings = cache(async (): Promise<SiteSettings> => {
  try {
    const { data } = await createAdminClient().from("app_settings").select("value").eq("key", KEY).maybeSingle();
    return mergeSiteSettings(data?.value);
  } catch {
    return SITE_DEFAULTS;
  }
});

/** True when an admin has saved anything; false means the defaults are showing. */
export async function siteSettingsCustomised(): Promise<boolean> {
  const { data } = await createAdminClient().from("app_settings").select("key").eq("key", KEY).maybeSingle();
  return !!data;
}

export async function saveSiteSettings(value: SiteSettings, actorId: string): Promise<void> {
  const { error } = await createAdminClient()
    .from("app_settings")
    .upsert({ key: KEY, value, updated_at: new Date().toISOString(), updated_by: actorId }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

export async function resetSiteSettings(): Promise<void> {
  const { error } = await createAdminClient().from("app_settings").delete().eq("key", KEY);
  if (error) throw new Error(error.message);
}
