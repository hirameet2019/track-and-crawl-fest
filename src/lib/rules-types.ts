import {
  EXPIRY_NOTICE_MAX_AGE_HOURS,
  MAX_COMPANIONS_PER_CAR,
  MAX_QTY_PER_TYPE,
  PAYMENT_CHANNELS,
  PAYMENT_WINDOW_MINUTES,
  REMINDER_MINUTES_BEFORE_EXPIRY,
  SHIRT_SIZES,
  SHIRT_SIZE_CHART,
  SHIRT_SIZE_CHART_IMAGE,
  type PaymentChannel,
} from "@/config/event";
import { NOTES, STAFF } from "@/config/site";
import type { PaymentMethod } from "@/lib/supabase/types";

/**
 * Business rules edited in Admin > Settings (Payments, Ordering, Advanced).
 * Plain data with no server imports, so client components can use the type and
 * the defaults; the store itself is src/lib/rules.ts.
 */

export interface ShirtRow {
  size: string;
  width: number;
  length: number;
  sleeve: number;
}

/**
 * Wording of the "Your details" step on the registration form. Labels get " *"
 * added by the form (every field is required); a blank hint or placeholder shows
 * nothing. Validation messages (bad email, mismatch, wrong mobile) stay in code.
 */
export interface BuyerFormText {
  title: string;
  subtitle: string;
  nameLabel: string;
  namePlaceholder: string;
  emailLabel: string;
  emailPlaceholder: string;
  emailHint: string;
  confirmLabel: string;
  confirmPlaceholder: string;
  confirmHint: string;
  mobileLabel: string;
  mobilePlaceholder: string;
  mobileHint: string;
}

export const BUYER_FORM_DEFAULTS: BuyerFormText = {
  title: "Your details",
  subtitle: "Dito ipapadala ang confirmation at QR pass. Siguraduhing tama ang email at cellphone number.",
  nameLabel: "Full name",
  namePlaceholder: "",
  emailLabel: "Email (tickets are sent here)",
  emailPlaceholder: "name@gmail.com",
  emailHint: "Your receipt and QR tickets go to this address only. Check Spam or Junk if it does not arrive.",
  confirmLabel: "Confirm email",
  confirmPlaceholder: "Type it again",
  confirmHint: "Retype it so a typo cannot send your tickets elsewhere.",
  mobileLabel: "Mobile number",
  mobilePlaceholder: "09171234567",
  mobileHint: "11 digits starting with 09. +63 works too.",
};

/**
 * The public registration page, Admin > Settings > Page: what shows and what it
 * says. `show` switches parts on and off; the rest is wording. Text may use
 * {pay} (e.g. "GoTyme Bank (InstaPay QR)"), {via} (e.g. "GoTyme (InstaPay QR)")
 * and {minutes} (the payment window); a blank line shows nothing.
 */
export interface PageSettings {
  show: {
    heroDate: boolean;
    heroVenue: boolean;
    heroTagline: boolean;
    heroPrices: boolean;
    heroButton: boolean;
    heroScrollCue: boolean;
    venue: boolean;
    mapsLink: boolean;
    date: boolean;
    time: boolean;
    tagline: boolean;
    presenters: boolean;
    gallery: boolean;
    sponsors: boolean;
    sideNote: boolean;
    support: boolean;
    footerNote: boolean;
    staffLink: boolean;
  };
  heroPricesLabel: string;
  heroButton: string;
  heading: string;
  sideNote: string;
  step1Title: string;
  step1Sub: string;
  step2Title: string;
  step2Sub: string;
  shippingTitle: string;
  shippingSub: string;
  submitButton: string;
  payNote: string;
  payNoteTl: string;
  closedTitle: string;
  closedText: string;
  closedTextTl: string;
  footerNote: string;
}

export const PAGE_DEFAULTS: PageSettings = {
  show: {
    heroDate: true,
    heroVenue: true,
    heroTagline: true,
    heroPrices: true,
    heroButton: true,
    heroScrollCue: true,
    venue: true,
    mapsLink: true,
    date: true,
    time: true,
    tagline: true,
    presenters: true,
    gallery: true,
    sponsors: true,
    sideNote: true,
    support: true,
    footerNote: true,
    staffLink: true,
  },
  heroPricesLabel: "Registration",
  heroButton: "Register now",
  heading: "Register your ride",
  sideNote: "Pay via {pay}.\nYour QR pass is emailed after we check your payment (check Spam too).",
  step1Title: "What are you bringing?",
  step1Sub: "One registration per car or motorcycle. Ilang sasakyan ang irerehistro? Pindutin ang + o -.",
  step2Title: "Vehicle details",
  step2Sub: "Driver o rider, plate, make/model at litrato ng bawat sasakyan.",
  shippingTitle: "Shirt delivery",
  shippingSub: "Saan ipapadala ang shirt.",
  submitButton: "Review & continue",
  payNote: "You will have {minutes} minutes to pay via {via} and upload your proof of payment.",
  payNoteTl: "Sa susunod na page ang QR at ang pag-upload ng screenshot.",
  closedTitle: "Online sales are closed",
  closedText: "Tickets may still be available at the venue gate.",
  closedTextTl: "Sarado na ang online ticket sales. Maaaring may tickets pa sa gate ng venue.",
  footerNote: "Payment via {pay}. Tickets are emailed after payment verification.",
};

/** Fill {pay}, {via} and {minutes} in page wording. Unknown tokens are left as typed. */
export const fillText = (text: string, vars: Partial<Record<"pay" | "via" | "minutes", string | number>>) =>
  text.replace(/\{(pay|via|minutes)\}/g, (m, k: "pay" | "via" | "minutes") => (vars[k] !== undefined ? String(vars[k]) : m));

export interface Rules {
  paymentWindowMinutes: number;
  reminderMinutes: number;
  expiryNoticeMaxAgeHours: number;
  maxQtyPerType: number;
  maxCompanionsPerCar: number;
  /** Sizes offered, in this order, with the supplier's measurements in inches. */
  shirtChart: ShirtRow[];
  /** Supplier chart image shown above the table; null hides it. */
  shirtChartImage: string | null;
  /** Wording per payment method. `accent` is styling and stays in code. */
  channels: Record<PaymentMethod, PaymentChannel>;
  staffUsernameDomain: string;
  drifterReferencePrefix: string;
  buyerForm: BuyerFormText;
  page: PageSettings;
}

export const RULE_DEFAULTS: Rules = {
  paymentWindowMinutes: PAYMENT_WINDOW_MINUTES,
  reminderMinutes: REMINDER_MINUTES_BEFORE_EXPIRY,
  expiryNoticeMaxAgeHours: EXPIRY_NOTICE_MAX_AGE_HOURS,
  maxQtyPerType: MAX_QTY_PER_TYPE,
  maxCompanionsPerCar: MAX_COMPANIONS_PER_CAR,
  shirtChart: SHIRT_SIZES.map((size) => ({ size, ...SHIRT_SIZE_CHART[size] })),
  shirtChartImage: SHIRT_SIZE_CHART_IMAGE.src,
  channels: structuredClone(PAYMENT_CHANNELS),
  staffUsernameDomain: STAFF.usernameDomain,
  drifterReferencePrefix: NOTES.drifterReferencePrefix,
  buyerForm: { ...BUYER_FORM_DEFAULTS },
  page: { ...PAGE_DEFAULTS, show: { ...PAGE_DEFAULTS.show } },
};

/** Staff pickers (walk-in, drifters): every method, short name, cash first. */
export const staffMethods = (channels: Rules["channels"]): { key: PaymentMethod; label: string }[] =>
  (["cash", "gotyme", "gcash", "maya"] as const).map((key) => ({ key, label: channels[key].app }));

/** "Width 20 in · Length 29 in · Sleeve 9.5 in" for a size, or null if it is not offered. */
export function shirtSummary(chart: ShirtRow[], size: string): string | null {
  const m = chart.find((r) => r.size === size);
  return m ? `Width ${m.width} in · Length ${m.length} in · Sleeve ${m.sleeve} in` : null;
}
