import { cache } from "react";
import { z } from "zod";
import { CIRCUIT_MAP_DEFAULT } from "@/config/circuit-map";
import { BRAND, CIRCUIT, GALLERY, HERO, INFO, NOTES, THEME, type GalleryPhoto, type HeroSlide } from "@/config/site";
import { MAP_LIMITS, type CircuitMapData } from "@/lib/circuit-map-types";
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
  /** The information block under the hero. */
  info: { endTime: string; presentedBy: string; sponsors: string };
  /** Past-event photos in the information block; the first is the large tile. */
  gallery: { title: string; photos: GalleryPhoto[] };
  /** The venue: circuit and paddock photos beside the circuit map (null hides the map). */
  circuit: { title: string; photos: GalleryPhoto[]; map: CircuitMapData | null };
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
  info: { ...INFO },
  gallery: { title: GALLERY.title, photos: GALLERY.photos.map((p) => ({ ...p })) },
  circuit: { title: CIRCUIT.title, photos: CIRCUIT.photos.map((p) => ({ ...p })), map: CIRCUIT_MAP_DEFAULT },
};

/** Most photos beside the circuit map; past this the column of photos gets too thin. */
export const MAX_CIRCUIT_PHOTOS = 6;

/** Most photos the gallery takes; the mosaic stops reading as a highlight reel past this. */
export const MAX_GALLERY_PHOTOS = 24;

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

const galleryPhoto = z.object({
  src: asset,
  alt: z.string().trim().min(1, "Every photo needs a short description").max(120),
  position: z.string().trim().max(40).regex(/^[a-z0-9%. -]*$/i, "Focus point looks wrong").optional(),
});

/* The circuit map. Paths come from the tracer, which only writes M, C and Z with numbers. */
const coord = z.number().finite().min(-5000).max(10000);
const degrees = z.number().finite().min(-720).max(720);
const mapItemId = z.string().regex(/^[a-z0-9]{1,16}$/i);
const pathData = (max: number) => z.string().max(max, "The map outline is too detailed; trace with more smoothing").regex(/^[MCZ0-9 .-]*$/, "The map outline looks wrong; trace it again");

export const traceSourceSchema = z.object({
  image: asset,
  color: z.tuple([z.number().int().min(0).max(255), z.number().int().min(0).max(255), z.number().int().min(0).max(255)]),
  tolerance: z.number().int().min(4).max(80),
  closeGaps: z.number().int().min(0).max(12),
  removeThin: z.number().int().min(0).max(12),
  smooth: z.number().int().min(1).max(6),
  curbs: z.boolean(),
});

export const circuitMapSchema = z.object({
  width: z.number().int().min(50).max(4000),
  height: z.number().int().min(50).max(4000),
  bounds: z.tuple([coord, coord, coord, coord]),
  asphalt: pathData(150_000).min(10, "The map has no track outline"),
  curbs: z.array(pathData(20_000)).max(MAP_LIMITS.curbs),
  startFinish: z
    .object({ x: coord, y: coord, angle: degrees, halfWidth: z.number().finite().min(2).max(300), gridBoxes: z.number().int().min(0).max(MAP_LIMITS.gridBoxes) })
    .nullable(),
  arrows: z.array(z.object({ id: mapItemId, x: coord, y: coord, angle: degrees })).max(MAP_LIMITS.arrows, `At most ${MAP_LIMITS.arrows} arrows`),
  blocks: z
    .array(z.object({ id: mapItemId, kind: z.enum(["building", "parking", "zone"]), x: coord, y: coord, w: z.number().finite().min(2).max(5000), h: z.number().finite().min(2).max(5000), angle: degrees }))
    .max(MAP_LIMITS.blocks, `At most ${MAP_LIMITS.blocks} blocks`),
  labels: z
    .array(
      z.object({
        id: mapItemId,
        x: coord,
        y: coord,
        text: z.string().trim().min(1, "Every map label needs text").max(MAP_LIMITS.text),
        angle: degrees,
        size: z.enum(["s", "m", "l"]),
        soft: z.boolean(),
        leader: z.object({ x: coord, y: coord }).nullable(),
      }),
    )
    .max(MAP_LIMITS.labels, `At most ${MAP_LIMITS.labels} labels`),
  source: traceSourceSchema.nullable(),
});

export const siteSettingsSchema = z.object({
  titleSuffix: z.string().trim().max(40),
  /** Blank: the event name is set as a type lockup instead (SiteLogo). */
  logo: asset.or(z.literal("")),
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
  info: z.object({
    endTime: z.string().trim().regex(/^(([01]\d|2[0-3]):[0-5]\d)?$/, "End time looks wrong, e.g. 17:00"),
    presentedBy: asset.or(z.literal("")),
    sponsors: asset.or(z.literal("")),
  }),
  gallery: z.object({
    /** Blank hides the heading above the photos. */
    title: z.string().trim().max(60),
    /** Empty hides the gallery. */
    photos: z.array(galleryPhoto).max(MAX_GALLERY_PHOTOS, `At most ${MAX_GALLERY_PHOTOS} photos`),
  }),
  circuit: z.object({
    /** Blank hides the heading. */
    title: z.string().trim().max(60),
    /** Empty leaves the map on its own. */
    photos: z.array(galleryPhoto).max(MAX_CIRCUIT_PHOTOS, `At most ${MAX_CIRCUIT_PHOTOS} circuit photos`),
    /** Null hides the map. */
    map: circuitMapSchema.nullable(),
  }),
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
  const gallery = (s.gallery ?? {}) as Record<string, unknown>;
  const circuit = (s.circuit ?? {}) as Record<string, unknown>;
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
    info: pick(shape.info, s.info, d.info),
    gallery: {
      title: "title" in gallery ? pick(shape.gallery.shape.title, gallery.title, d.gallery.title) : d.gallery.title,
      photos: pick(shape.gallery.shape.photos, gallery.photos, d.gallery.photos),
    },
    circuit: {
      title: "title" in circuit ? pick(shape.circuit.shape.title, circuit.title, d.circuit.title) : d.circuit.title,
      photos: pick(shape.circuit.shape.photos, circuit.photos, d.circuit.photos),
      map: "map" in circuit ? pick(shape.circuit.shape.map, circuit.map, d.circuit.map) : d.circuit.map,
    },
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
