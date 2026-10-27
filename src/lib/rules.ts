import { cache } from "react";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { MAX_EXTRA_CHANNELS, PAGE_DEFAULTS, PAY_PAGE_DEFAULTS, RULE_DEFAULTS, type PageSettings, type PayPageSettings, type Rules } from "@/lib/rules-types";
import type { PaymentMethod } from "@/lib/supabase/types";

/**
 * Store for the business rules in Admin > Settings: one JSON value in
 * app_settings under KEY. Missing or invalid parts fall back to RULE_DEFAULTS
 * (the constants in src/config/event.ts and site.ts), one field at a time.
 */
const KEY = "rules";

const asset = z
  .string()
  .trim()
  .max(500)
  .refine((v) => /^\/[^/]/.test(v) || /^https:\/\//.test(v), "Images must be a /public path or an uploaded file");

const channel = z.object({
  label: z.string().trim().min(1, "Every channel needs a name").max(40),
  app: z.string().trim().min(1, "Every channel needs a short name").max(30),
  via: z.string().trim().min(1).max(60),
  payVia: z.string().trim().min(1).max(80),
  scanHint: z.string().trim().max(120).optional(),
  hint: z.string().trim().max(240).optional(),
  referenceImage: asset.optional(),
  accent: z.string().max(40),
});

const shirtRow = z.object({
  size: z.string().trim().min(1, "Every row needs a size").max(8).regex(/^[A-Za-z0-9]+$/, "Sizes are letters and digits, e.g. XL or 2XL"),
  width: z.number().min(1).max(80),
  length: z.number().min(1).max(80),
  sleeve: z.number().min(0).max(80),
});

const label = (what: string) => z.string().trim().min(1, `${what} cannot be blank`).max(60);
const buyerForm = z.object({
  title: label("The step title"),
  subtitle: z.string().trim().max(240),
  nameLabel: label("The name label"),
  namePlaceholder: z.string().trim().max(60),
  emailLabel: label("The email label"),
  emailPlaceholder: z.string().trim().max(60),
  emailHint: z.string().trim().max(200),
  confirmLabel: label("The confirm-email label"),
  confirmPlaceholder: z.string().trim().max(60),
  confirmHint: z.string().trim().max(200),
  mobileLabel: label("The mobile label"),
  mobilePlaceholder: z.string().trim().max(60),
  mobileHint: z.string().trim().max(200),
});

const line = (max: number) => z.string().trim().max(max);
const page = z.object({
  show: z.object(Object.fromEntries(Object.keys(PAGE_DEFAULTS.show).map((k) => [k, z.boolean()])) as Record<keyof PageSettings["show"], z.ZodBoolean>),
  heroPricesLabel: line(40),
  heroButton: label("The hero button"),
  heading: label("The registration heading"),
  sideNote: line(300),
  step1Title: label("The step 1 title"),
  step1Sub: line(240),
  step2Title: label("The step 2 title"),
  step2Sub: line(240),
  shippingTitle: label("The shirt-delivery title"),
  shippingSub: line(240),
  submitButton: label("The continue button"),
  payNote: line(300),
  payNoteTl: line(300),
  closedTitle: label("The sales-closed title"),
  closedText: line(300),
  closedTextTl: line(300),
  footerNote: line(300),
});

const BUILT_IN_IDS = ["gotyme", "gcash", "maya", "cash", "other"];
const extraChannel = z.object({
  id: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,30}$/, "Channel ids are 2-31 lowercase letters, digits or dashes")
    .refine((v) => !BUILT_IN_IDS.includes(v), "That id belongs to a built-in channel; pick another"),
  enabled: z.boolean(),
  label: z.string().trim().min(1, "Every channel needs a full name").max(60),
  app: z.string().trim().min(1, "Every channel needs a short name").max(30),
  via: z.string().trim().min(1, "Every channel needs its \"pay via\" wording").max(60),
  payVia: z.string().trim().min(1, "Every channel needs its \"pay via\" wording").max(80),
  qrUrl: asset.nullable(),
  accountName: line(120),
  accountNumber: line(60),
  hint: line(240),
  referenceImage: asset.nullable(),
});
const extraChannels = z
  .array(extraChannel)
  .max(MAX_EXTRA_CHANNELS, `At most ${MAX_EXTRA_CHANNELS} extra channels`)
  .refine((list) => new Set(list.map((c) => c.id)).size === list.length, "Two channels have the same id")
  .refine((list) => list.every((c) => !c.enabled || c.qrUrl || c.accountNumber), "A channel that is switched on needs a QR code or an account number");

const payPage = z.object({
  show: z.object(Object.fromEntries(Object.keys(PAY_PAGE_DEFAULTS.show).map((k) => [k, z.boolean()])) as Record<keyof PayPageSettings["show"], z.ZodBoolean>),
  title: label("The payment page title"),
  holdNote: line(300),
  holdWarning: line(400),
  holdWarningTl: line(400),
  summaryTitle: label("The summary title"),
  totalLabel: label("The total label"),
  step1Title: label("The step 1 title"),
  step1Text: line(300),
  step1TextTl: line(300),
  exactCallout: line(500),
  exactCalloutTl: line(300),
  step2Title: label("The step 2 title"),
  step2Text: line(300),
  step2TextTl: line(300),
  methodLabel: label("The \"I paid with\" label"),
  onlyOneNote: line(200),
  referenceLabel: label("The reference number label"),
  referencePlaceholder: line(60),
  referenceHint: line(300),
  referenceHelpTitle: line(120),
  referenceHelpText: line(500),
  referenceHelpTextTl: line(300),
  screenshotLabel: label("The screenshot label"),
  screenshotHint: line(300),
  submitButton: label("The submit button"),
  afterTitle: line(60),
  afterText: line(500),
  afterText2: line(500),
  afterTextTl: line(300),
});

export const rulesSchema = z.object({
  paymentWindowMinutes: z.number().int().min(15, "Give buyers at least 15 minutes to pay").max(24 * 60, "At most 24 hours to pay"),
  reminderMinutes: z.number().int().min(5).max(120),
  expiryNoticeMaxAgeHours: z.number().int().min(1).max(48),
  maxQtyPerType: z.number().int().min(1).max(50),
  maxCompanionsPerCar: z.number().int().min(0).max(30),
  shirtChart: z
    .array(shirtRow)
    .min(1, "Offer at least one shirt size")
    .max(20)
    .refine((rows) => new Set(rows.map((r) => r.size.toUpperCase())).size === rows.length, "Each shirt size may appear once"),
  shirtChartImage: asset.nullable(),
  channels: z.object({ gotyme: channel, gcash: channel, maya: channel, cash: channel }),
  staffUsernameDomain: z.string().trim().toLowerCase().regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/, "Domain looks wrong, e.g. drift.local"),
  drifterReferencePrefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,6}$/, "Prefix is 1-6 letters or digits"),
  buyerForm,
  page,
  extraChannels,
  payPage,
}).refine((r) => r.reminderMinutes < r.paymentWindowMinutes, { message: "The reminder must go out before the hold runs out", path: ["reminderMinutes"] });

/** Lay stored values over the defaults field by field. Exported for tests. */
export function mergeRules(stored: unknown): Rules {
  const s = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;
  const d = RULE_DEFAULTS;
  const base = rulesSchema.shape;
  const pick = <T,>(schema: z.ZodType<T>, value: unknown, fallback: T): T => {
    const r = schema.safeParse(value);
    return r.success ? r.data : fallback;
  };
  const storedChannels = (s.channels ?? {}) as Record<string, unknown>;
  const channels = Object.fromEntries(
    (Object.keys(d.channels) as PaymentMethod[]).map((k) => {
      const merged = pick(channel, { ...d.channels[k], ...(storedChannels[k] as object | undefined) }, d.channels[k]);
      // Styling is not editable; always the code's.
      return [k, { ...merged, accent: d.channels[k].accent }];
    }),
  ) as Rules["channels"];
  const merged: Rules = {
    paymentWindowMinutes: pick(base.paymentWindowMinutes, s.paymentWindowMinutes, d.paymentWindowMinutes),
    reminderMinutes: pick(base.reminderMinutes, s.reminderMinutes, d.reminderMinutes),
    expiryNoticeMaxAgeHours: pick(base.expiryNoticeMaxAgeHours, s.expiryNoticeMaxAgeHours, d.expiryNoticeMaxAgeHours),
    maxQtyPerType: pick(base.maxQtyPerType, s.maxQtyPerType, d.maxQtyPerType),
    maxCompanionsPerCar: pick(base.maxCompanionsPerCar, s.maxCompanionsPerCar, d.maxCompanionsPerCar),
    shirtChart: pick(base.shirtChart, s.shirtChart, d.shirtChart),
    shirtChartImage: "shirtChartImage" in s ? pick(base.shirtChartImage, s.shirtChartImage, d.shirtChartImage) : d.shirtChartImage,
    channels,
    staffUsernameDomain: pick(base.staffUsernameDomain, s.staffUsernameDomain, d.staffUsernameDomain),
    drifterReferencePrefix: pick(base.drifterReferencePrefix, s.drifterReferencePrefix, d.drifterReferencePrefix),
    // Field by field over the defaults, so wording added to the form later still has text.
    buyerForm: pick(buyerForm, { ...d.buyerForm, ...(s.buyerForm as object | undefined) }, d.buyerForm),
    page: (() => {
      const sp = (s.page ?? {}) as Partial<PageSettings>;
      return pick(page, { ...d.page, ...sp, show: { ...d.page.show, ...(sp.show ?? {}) } }, d.page);
    })(),
    extraChannels: pick(extraChannels, s.extraChannels, d.extraChannels),
    payPage: (() => {
      const sp = (s.payPage ?? {}) as Partial<PayPageSettings>;
      return pick(payPage, { ...d.payPage, ...sp, show: { ...d.payPage.show, ...(sp.show ?? {}) } }, d.payPage);
    })(),
  };
  // A reminder that lands after expiry would never send; keep the pair coherent.
  if (merged.reminderMinutes >= merged.paymentWindowMinutes) merged.reminderMinutes = Math.min(d.reminderMinutes, merged.paymentWindowMinutes - 1);
  return merged;
}

/** Effective rules, once per request. Never throws: on a failed read the defaults apply. */
export const getRules = cache(async (): Promise<Rules> => {
  try {
    const { data } = await createAdminClient().from("app_settings").select("value").eq("key", KEY).maybeSingle();
    return mergeRules(data?.value);
  } catch {
    return RULE_DEFAULTS;
  }
});

export async function saveRules(value: Rules, actorId: string): Promise<void> {
  const { error } = await createAdminClient()
    .from("app_settings")
    .upsert({ key: KEY, value, updated_at: new Date().toISOString(), updated_by: actorId }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}
