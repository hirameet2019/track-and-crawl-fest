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
import { STAFF } from "@/config/site";
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
    circuit: boolean;
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
  /** Shown instead of payNote when there is no payment deadline. */
  payNoteOpen: string;
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
    circuit: true,
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
  payNoteOpen: "Next you pay via {via} and upload your proof of payment.",
  payNoteTl: "Sa susunod na page ang QR at ang pag-upload ng screenshot.",
  closedTitle: "Online sales are closed",
  closedText: "Tickets may still be available at the venue gate.",
  closedTextTl: "Sarado na ang online ticket sales. Maaaring may tickets pa sa gate ng venue.",
  footerNote: "Payment via {pay}. Tickets are emailed after payment verification.",
};

/**
 * A payment channel added in Admin > Settings > Payments, beside the built-in
 * GoTyme / GCash / Maya: a bank transfer, another e-wallet. Offered on the payment
 * page when enabled and it has a QR or an account number. Orders paid through it
 * record payment_method "other" plus this id and label.
 */
export interface ExtraChannel {
  /** Stable id stored on orders; lowercase letters, digits and dashes. */
  id: string;
  enabled: boolean;
  /** Full name on the payment card and staff screens, e.g. "BPI bank transfer". */
  label: string;
  /** Short name in instructions: "Open your BPI app". */
  app: string;
  /** "Pay via" on the order form. */
  via: string;
  /** "Pay via" in page text and emails. */
  payVia: string;
  qrUrl: string | null;
  accountName: string;
  accountNumber: string;
  /** Note under the QR / account details. */
  hint: string;
  /** Screenshot under "Where do I find the reference number?". */
  referenceImage: string | null;
}

export const MAX_EXTRA_CHANNELS = 8;

/**
 * The payment page (/pay/<order>): what shows and what it says. Text may use
 * {amount}, {order}, {name}, {email}, {minutes}, {app}, {item}, {items} and {scanHint} (" (or any
 * bank app with InstaPay QR)" or nothing); **double asterisks** make bold. The hold
 * note may place the live countdown with {timeLeft}; the after-submit text may
 * place the order status link with {statusLink}.
 */
export interface PayPageSettings {
  show: {
    holdNote: boolean;
    holdWarning: boolean;
    summary: boolean;
    accountName: boolean;
    accountNumber: boolean;
    exactCallout: boolean;
    referenceHelp: boolean;
    afterSubmit: boolean;
    support: boolean;
  };
  title: string;
  holdNote: string;
  /** Shown instead of holdNote (and with no warning) when there is no payment deadline. */
  holdNoteOpen: string;
  holdWarning: string;
  holdWarningTl: string;
  summaryTitle: string;
  totalLabel: string;
  step1Title: string;
  step1Text: string;
  step1TextTl: string;
  exactCallout: string;
  exactCalloutTl: string;
  step2Title: string;
  step2Text: string;
  step2TextTl: string;
  methodLabel: string;
  onlyOneNote: string;
  referenceLabel: string;
  referencePlaceholder: string;
  referenceHint: string;
  referenceHelpTitle: string;
  referenceHelpText: string;
  referenceHelpTextTl: string;
  screenshotLabel: string;
  screenshotHint: string;
  submitButton: string;
  afterTitle: string;
  afterText: string;
  afterText2: string;
  afterTextTl: string;
}

export const PAY_PAGE_DEFAULTS: PayPageSettings = {
  show: {
    holdNote: true,
    holdWarning: true,
    summary: true,
    accountName: true,
    accountNumber: true,
    exactCallout: true,
    referenceHelp: true,
    afterSubmit: true,
    support: true,
  },
  title: "Pay {amount}",
  holdNote: "Order #{order} for {name}. Your {items} are held for {minutes} minutes, and {timeLeft} of that is left.",
  holdNoteOpen: "Order #{order} for {name}. Your {items} are reserved for you until you pay and upload your proof.",
  holdWarning: "Pay and upload before the timer ends. When it runs out the order is cancelled, the {items} go back to the pool, and this page stops accepting payment.",
  holdWarningTl: "Naka-hold ang {items} mo ng {minutes} minuto. Bayaran at i-upload ang proof bago matapos ang oras. Pag naubos ito, kanselado na ang order at kailangan mo nang mag-order ulit.",
  summaryTitle: "Order summary",
  totalLabel: "Total to pay",
  step1Title: "Scan and pay the exact amount",
  step1Text: "Open your {app} app{scanHint}, scan the code, and pay the exact amount.",
  step1TextTl: "Buksan ang {app} app, i-scan ang QR, at bayaran ang eksaktong halaga.",
  exactCallout: "Pay exactly **{amount}**. Put **Order #{order}** in the message or note if your app allows it. Take a screenshot of the confirmation. Any InstaPay transfer fee is charged by your own bank on top, so the amount received must still be the full ticket price.",
  exactCalloutTl: "Eksaktong **{amount}** ang ipadala. Pagkatapos magbayad, i-screenshot ang confirmation screen.",
  step2Title: "Submit your proof of payment",
  step2Text: "Type the reference number and upload the screenshot of your confirmation.",
  step2TextTl: "Ilagay ang reference number at i-upload ang screenshot ng confirmation.",
  methodLabel: "I paid with",
  onlyOneNote: "Only {app} is accepted for now.",
  referenceLabel: "Reference number",
  referencePlaceholder: "e.g. 20260918ABCD1234",
  referenceHint: "The reference / transaction number on your payment confirmation screen. Letters and digits, spaces are ignored.",
  referenceHelpTitle: "Where do I find the reference number? Saan ito makikita?",
  referenceHelpText: "Open your bank or e-wallet app, tap the transfer you just made, and copy the long number labelled **Reference No.**, **Transaction ID**, or **Trace No.** It is also on the confirmation screenshot.",
  referenceHelpTextTl: "Buksan ang app, hanapin ang transfer na ginawa mo, at kopyahin ang mahabang numero na Reference No. o Transaction ID.",
  screenshotLabel: "Payment screenshot",
  screenshotHint: "The screenshot of your \"Transfer successful\" screen. Large screenshots are resized automatically. Screenshot ng confirmation ng bayad mo.",
  submitButton: "Submit proof of payment / I-submit ang proof",
  afterTitle: "After you submit",
  afterText: "Every payment is checked by a real person against the account history, so your tickets are not instant. Please allow **up to 24 hours** for your receipt and QR tickets to arrive at **{email}**. Most are sent much sooner.",
  afterText2: "If nothing arrives, look in your **Spam or Junk folder** first and mark the message as Not spam. You can also check your order any time at {statusLink}; it updates the moment your payment is confirmed.",
  afterTextTl: "Pagkatapos i-submit, hintayin ang email na may receipt at QR tickets, hanggang 24 oras. Tingnan din ang Spam folder.",
};

/**
 * What one registration is called on every page, email, PDF and staff screen.
 * Track & Crawl sells registrations. An event that hands out wristbands would set
 * "wristband" / "wristbands" / "Wristband no." with `physical` on.
 */
export interface Terms {
  /** "registration" (lowercase; capitalised where a sentence starts). */
  one: string;
  /** "registrations". */
  many: string;
  /** Column and field label for its number, e.g. "Registration no.". */
  numberLabel: string;
  /** Something is handed over at the gate (a wristband): adds the "staff hand you ..." lines. */
  physical: boolean;
}

export const TERMS_DEFAULTS: Terms = { one: "registration", many: "registrations", numberLabel: "Registration no.", physical: false };

/** "registration" -> "Registration". */
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Fill {pay}, {via} and {minutes} in page wording. Unknown tokens are left as typed. */
export const fillText = (text: string, vars: Partial<Record<"pay" | "via" | "minutes", string | number>>) =>
  text.replace(/\{(pay|via|minutes)\}/g, (m, k: "pay" | "via" | "minutes") => (vars[k] !== undefined ? String(vars[k]) : m));

export interface Rules {
  /**
   * Unpaid orders are cancelled automatically once paymentWindowMinutes pass. Off:
   * they have no deadline and hold their numbers until staff cancel them.
   */
  paymentDeadline: boolean;
  paymentWindowMinutes: number;
  /** Email the buyer reminderMinutes before the deadline (needs the deadline and the cron). */
  paymentReminder: boolean;
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
  buyerForm: BuyerFormText;
  page: PageSettings;
  /** Payment channels added in Settings, after GoTyme / GCash / Maya, in this order. */
  extraChannels: ExtraChannel[];
  payPage: PayPageSettings;
  terms: Terms;
}

export const RULE_DEFAULTS: Rules = {
  paymentDeadline: true,
  paymentWindowMinutes: PAYMENT_WINDOW_MINUTES,
  paymentReminder: true,
  reminderMinutes: REMINDER_MINUTES_BEFORE_EXPIRY,
  expiryNoticeMaxAgeHours: EXPIRY_NOTICE_MAX_AGE_HOURS,
  maxQtyPerType: MAX_QTY_PER_TYPE,
  maxCompanionsPerCar: MAX_COMPANIONS_PER_CAR,
  shirtChart: SHIRT_SIZES.map((size) => ({ size, ...SHIRT_SIZE_CHART[size] })),
  shirtChartImage: SHIRT_SIZE_CHART_IMAGE?.src ?? null,
  channels: structuredClone(PAYMENT_CHANNELS),
  staffUsernameDomain: STAFF.usernameDomain,
  buyerForm: { ...BUYER_FORM_DEFAULTS },
  page: { ...PAGE_DEFAULTS, show: { ...PAGE_DEFAULTS.show } },
  extraChannels: [],
  payPage: { ...PAY_PAGE_DEFAULTS, show: { ...PAY_PAGE_DEFAULTS.show } },
  terms: { ...TERMS_DEFAULTS },
};

/** Staff pickers (walk-in, drifters): every method, short name, cash first. */
export const staffMethods = (channels: Rules["channels"]): { key: PaymentMethod; label: string }[] =>
  (["cash", "gotyme", "gcash", "maya"] as const).map((key) => ({ key, label: channels[key].app }));

/** "Width 20 in · Length 29 in · Sleeve 9.5 in" for a size, or null if it is not offered. */
export function shirtSummary(chart: ShirtRow[], size: string): string | null {
  const m = chart.find((r) => r.size === size);
  return m ? `Width ${m.width} in · Length ${m.length} in · Sleeve ${m.sleeve} in` : null;
}
