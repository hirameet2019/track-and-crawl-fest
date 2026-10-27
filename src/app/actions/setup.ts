"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertSystem } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { fromManilaLocalInput } from "@/lib/cutoff";
import { getActiveEvent } from "@/lib/queries";
import { getSiteSettings, resetSiteSettings, saveSiteSettings, siteSettingsSchema, type SiteSettings } from "@/lib/site-settings";
import { getRules, rulesSchema, saveRules } from "@/lib/rules";
import type { Rules } from "@/lib/rules-types";
import { createAdminClient } from "@/lib/supabase/admin";
import type { EventRow, TicketTypeRow } from "@/lib/supabase/types";
import { changedKeys } from "@/lib/same-value";
import type { ActionResult } from "./orders";

/**
 * Admin > Settings: event details, ticket types, and the look of the site.
 * Admin only. Every change is audited and takes effect on the next page load,
 * no deploy needed.
 */

const fail = (e: unknown): ActionResult => ({ ok: false, error: e instanceof Error ? e.message : "Could not save" });
const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? "Invalid input";

/** Every page reads these settings, so refresh the whole site. */
const refreshSite = () => revalidatePath("/", "layout");

/* ------------------------------------------------------------------ uploads */

const UPLOAD_TYPES: Record<string, { ext: string; maxMb: number }> = {
  "image/png": { ext: "png", maxMb: 10 },
  "image/jpeg": { ext: "jpg", maxMb: 10 },
  "image/webp": { ext: "webp", maxMb: 10 },
  "video/mp4": { ext: "mp4", maxMb: 50 },
  "video/webm": { ext: "webm", maxMb: 50 },
};

/**
 * A one-time signed URL for uploading one file to the public event-assets bucket.
 * The browser uploads straight to Storage, so large videos never pass through a
 * server action (those cap at 10 MB). Returns the public URL to save.
 */
export async function createAssetUpload(
  contentType: string,
  size: number,
): Promise<{ ok: true; path: string; token: string; publicUrl: string } | { ok: false; error: string }> {
  try {
    await assertSystem();
    const t = UPLOAD_TYPES[contentType];
    if (!t) return { ok: false, error: "Use a PNG, JPG or WebP image, or an MP4 / WebM video" };
    if (!Number.isFinite(size) || size <= 0) return { ok: false, error: "That file is empty" };
    if (size > t.maxMb * 1024 * 1024) return { ok: false, error: `Keep it under ${t.maxMb} MB` };
    const path = `site/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${t.ext}`;
    const admin = createAdminClient();
    const { data, error } = await admin.storage.from("event-assets").createSignedUploadUrl(path);
    if (error || !data) return { ok: false, error: error?.message ?? "Could not start the upload" };
    const publicUrl = admin.storage.from("event-assets").getPublicUrl(path).data.publicUrl;
    return { ok: true, path: data.path, token: data.token, publicUrl };
  } catch (e) {
    return fail(e) as { ok: false; error: string };
  }
}

/* ------------------------------------------------------------- site look */

export async function saveSiteSettingsAction(value: SiteSettings): Promise<ActionResult> {
  try {
    const { userId } = await assertSystem();
    const parsed = siteSettingsSchema.safeParse(value);
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
    const before = await getSiteSettings();
    const next: SiteSettings = {
      ...parsed.data,
      salesScheduleNote: parsed.data.salesScheduleNote || null,
      hero: { ...parsed.data.hero, slides: parsed.data.hero.slides.map((s) => ({ ...s, video: s.video || undefined })) },
      gallery: { ...parsed.data.gallery, photos: parsed.data.gallery.photos.map((p) => ({ ...p, position: p.position || undefined })) },
      circuit: { ...parsed.data.circuit, photos: parsed.data.circuit.photos.map((p) => ({ ...p, position: p.position || undefined })) },
    };
    await saveSiteSettings(next, userId);
    await audit(createAdminClient(), {
      actor: userId, action: "settings.site_updated", entity: "app_settings", entity_id: "site",
      data: { changed: changedKeys(before as unknown as Record<string, unknown>, next as unknown as Record<string, unknown>) },
    });
    refreshSite();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function resetSiteSettingsAction(): Promise<ActionResult> {
  try {
    const { userId } = await assertSystem();
    await resetSiteSettings();
    await audit(createAdminClient(), { actor: userId, action: "settings.site_reset", entity: "app_settings", entity_id: "site", data: {} });
    refreshSite();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/* ----------------------------------------------------------- event details */

const optText = (max: number) => z.string().trim().max(max).transform((v) => v || null);
const asset = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === "" || /^\/[^/]/.test(v) || /^https:\/\//.test(v), "QR images must be a /public path or an uploaded file")
  .transform((v) => v || null);
/** datetime-local in Manila time → ISO at the start of that minute, or null when blank. */
const manilaTime = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (!v) return null;
    const iso = fromManilaLocalInput(v);
    if (!iso) {
      ctx.addIssue({ code: "custom", message: "Enter a full date and time" });
      return z.NEVER;
    }
    const d = new Date(iso);
    d.setUTCSeconds(0, 0);
    return d.toISOString();
  });

const eventSchema = z.object({
  name: z.string().trim().min(2, "Enter the event name").max(120),
  tagline: optText(120),
  venue: optText(200),
  starts_at: manilaTime,
  sales_open_at: manilaTime,
  sales_close_at: manilaTime,
  org_name: z.string().trim().min(2, "Enter the organizer's name for the receipt").max(200),
  org_tin: optText(40),
  org_address: optText(300),
  org_vat_registered: z.boolean(),
  receipt_label: z.enum(["ACKNOWLEDGMENT RECEIPT", "OFFICIAL RECEIPT"]),
  refund_policy: optText(1500),
  support_contact_label: optText(80),
  support_contact_url: z
    .string()
    .trim()
    .max(300)
    .refine((v) => v === "" || /^(https:\/\/|mailto:|tel:)/.test(v), "The help link must start with https://, mailto: or tel:")
    .transform((v) => v || null),
});
export type EventDetailsInput = z.input<typeof eventSchema>;

const paymentQrSchema = z.object({
  gotyme_qr_url: asset,
  gotyme_account_name: optText(120),
  gcash_qr_url: asset,
  gcash_account_name: optText(120),
  maya_qr_url: asset,
  maya_account_name: optText(120),
});
export type PaymentQrInput = z.input<typeof paymentQrSchema>;

export async function saveEventDetails(input: EventDetailsInput): Promise<ActionResult> {
  try {
    const { userId } = await assertSystem();
    const parsed = eventSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
    const v = parsed.data;
    if (v.sales_open_at && v.sales_close_at && v.sales_close_at <= v.sales_open_at) {
      return { ok: false, error: "Sales must close after they open" };
    }
    if (v.support_contact_url && !v.support_contact_label) return { ok: false, error: "Give the help link a label, e.g. Message us on Facebook" };

    const event = await getActiveEvent();
    if (!event) return { ok: false, error: "No active event to edit" };
    const admin = createAdminClient();
    const { error } = await admin.from("events").update(v).eq("id", event.id);
    if (error) return { ok: false, error: error.message };
    await audit(admin, {
      actor: userId, action: "event.updated", entity: "event", entity_id: event.id,
      data: { changed: changedKeys(event as unknown as Record<string, unknown>, v) },
    });
    refreshSite();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Payment QR codes and account names on the events row (Payments tab). */
export async function savePaymentQr(input: PaymentQrInput): Promise<ActionResult> {
  try {
    const { userId } = await assertSystem();
    const parsed = paymentQrSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
    const v = parsed.data;
    if (!v.gotyme_qr_url && !v.gcash_qr_url && !v.maya_qr_url) {
      return { ok: false, error: "Keep at least one payment QR code, or buyers will have no way to pay" };
    }
    const event = await getActiveEvent();
    if (!event) return { ok: false, error: "No active event to edit" };
    const admin = createAdminClient();
    const { error } = await admin.from("events").update(v).eq("id", event.id);
    if (error) return { ok: false, error: error.message };
    await audit(admin, {
      actor: userId, action: "event.updated", entity: "event", entity_id: event.id,
      data: { changed: changedKeys(event as unknown as Record<string, unknown>, v) },
    });
    refreshSite();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/* ------------------------------------------------------------------ rules */

/**
 * Save one tab's part of the business rules (Payments, Ordering, Advanced). The
 * patch is laid over the current rules and the whole set is validated, so a tab
 * cannot leave the rules inconsistent (e.g. a reminder later than the hold).
 */
export async function saveRulesSection(patch: Partial<Rules>): Promise<ActionResult> {
  try {
    const { userId } = await assertSystem();
    const before = await getRules();
    const parsed = rulesSchema.safeParse({ ...before, ...patch });
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
    const next = parsed.data as Rules;
    await saveRules(next, userId);
    await audit(createAdminClient(), {
      actor: userId, action: "settings.rules_updated", entity: "app_settings", entity_id: "rules",
      data: { changed: changedKeys(before as unknown as Record<string, unknown>, next as unknown as Record<string, unknown>) },
    });
    refreshSite();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/* ------------------------------------------------------------ ticket types */

const peso = (label: string) =>
  z.number({ message: `${label}: enter an amount` }).min(0, `${label} cannot be negative`).max(1_000_000).transform((p) => Math.round(p * 100));

const ticketTypeSchema = z.object({
  id: z.string().uuid().nullable(),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,3}$/, "Code is the letter on the band serials: 1-3 letters or digits"),
  name: z.string().trim().min(2, "Enter a name").max(80),
  description: optText(400),
  price: peso("Online price"),
  walkin_price: peso("Gate price").nullable(),
  band_color: optText(40),
  sell_online: z.boolean(),
  sell_at_gate: z.boolean(),
  walkin_name: optText(80),
  gate_needs_name: z.boolean(),
  includes_shirt: z.boolean(),
  ships_shirt: z.boolean(),
  hidden_in_admin: z.boolean(),
  includes_lanyard: z.boolean(),
  includes_sticker: z.boolean(),
  includes_car_pass: z.boolean(),
  requires_vehicle: z.boolean(),
  included_companions: z.number().int().min(0).max(12),
  is_child: z.boolean(),
  online_cap: z.number().int().min(0).max(100_000).nullable(),
  drifter_family: z.boolean(),
  free_allowance: z.number().int().min(0).max(50),
  sort_order: z.number().int().min(0).max(999),
  active: z.boolean(),
});
export type TicketTypeInput = z.input<typeof ticketTypeSchema>;

export async function saveTicketType(input: TicketTypeInput): Promise<ActionResult> {
  try {
    const { userId } = await assertSystem();
    const parsed = ticketTypeSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
    const { id, price, walkin_price, ...rest } = parsed.data;
    const row = { ...rest, price_centavos: price, walkin_price_centavos: walkin_price };
    if (row.sell_online && row.price_centavos === 0 && !row.drifter_family) {
      return { ok: false, error: "A ticket sold online needs a price above zero" };
    }
    if (row.ships_shirt && !row.includes_shirt) row.ships_shirt = false;
    if (row.included_companions > 0 && !row.requires_vehicle) {
      return { ok: false, error: "Free companions ride on a car ticket: tick \"Needs car details\" or set companions to 0" };
    }

    const event = await getActiveEvent();
    if (!event) return { ok: false, error: "No active event" };
    const admin = createAdminClient();

    // The code is how wristband serials find their type; once bands are loaded it must stay.
    let before: TicketTypeRow | null = null;
    if (id) {
      const { data } = await admin.from("ticket_types").select("*").eq("id", id).eq("event_id", event.id).maybeSingle();
      if (!data) return { ok: false, error: "That ticket type is not part of the active event" };
      before = data as TicketTypeRow;
      if (before.code !== row.code) {
        const { count } = await admin.from("ticket_numbers").select("id", { count: "exact", head: true }).eq("ticket_type_id", id);
        if (count) return { ok: false, error: `Code stays ${before.code}: ${count} ${(await getRules()).terms.one} numbers are already loaded under it` };
      }
    }
    const { data: clash } = await admin.from("ticket_types").select("id").eq("event_id", event.id).eq("code", row.code).maybeSingle();
    if (clash && clash.id !== id) return { ok: false, error: `Another ticket type already uses code ${row.code}` };

    const saved = id
      ? await admin.from("ticket_types").update(row).eq("id", id).select("id").single()
      : await admin.from("ticket_types").insert({ ...row, event_id: event.id }).select("id").single();
    if (saved.error) return { ok: false, error: saved.error.message };

    await audit(admin, {
      actor: userId, action: id ? "ticket_type.updated" : "ticket_type.created", entity: "ticket_type", entity_id: saved.data.id,
      data: { code: row.code, name: row.name, changed: before ? changedKeys(before as unknown as Record<string, unknown>, row) : Object.keys(row) },
    });
    refreshSite();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Fields the Settings page shows for the event, as the form expects them. */
export type EventFormValues = Pick<
  EventRow,
  | "name" | "tagline" | "venue" | "starts_at" | "sales_open_at" | "sales_close_at" | "org_name" | "org_tin" | "org_address"
  | "org_vat_registered" | "receipt_label" | "refund_policy" | "support_contact_label" | "support_contact_url"
>;

/** The events row's payment fields, as the Payments tab expects them. */
export type PaymentQrValues = Pick<
  EventRow,
  "gotyme_qr_url" | "gotyme_account_name" | "gcash_qr_url" | "gcash_account_name" | "maya_qr_url" | "maya_account_name"
>;
