"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveRulesSection } from "@/app/actions/setup";
import { Group, SaveBar, changed, type SaveMsg } from "@/components/settings/SaveBar";
import { BUYER_FORM_DEFAULTS, PAGE_DEFAULTS, TERMS_DEFAULTS, type BuyerFormText, type PageSettings, type Rules, type Terms } from "@/lib/rules-types";

type Show = keyof PageSettings["show"];
type Text = Exclude<keyof PageSettings, "show">;

/** Switches, grouped the way the page reads from top to bottom. */
const SWITCHES: { title: string; hint?: string; items: { key: Show; label: string }[] }[] = [
  {
    title: "Hero",
    hint: "The big banner at the top. The artwork, logo and effects are under Look.",
    items: [
      { key: "heroDate", label: "Date and start time" },
      { key: "heroVenue", label: "Venue" },
      { key: "heroTagline", label: "Tagline" },
      { key: "heroPrices", label: "Registration prices" },
      { key: "heroButton", label: "Register now button" },
      { key: "heroScrollCue", label: "Scroll arrow" },
    ],
  },
  {
    title: "Event details",
    hint: "The block under the hero. Venue, date and tagline come from Event; presenters, gallery, circuit photos and sponsors from Look.",
    items: [
      { key: "venue", label: "Venue" },
      { key: "mapsLink", label: "Open in Google Maps link" },
      { key: "date", label: "Event date" },
      { key: "time", label: "Time" },
      { key: "tagline", label: "Tagline" },
      { key: "circuit", label: "Circuit photos and map" },
      { key: "presenters", label: "Presented by" },
      { key: "gallery", label: "Past event photos" },
      { key: "sponsors", label: "Sponsors" },
    ],
  },
  {
    title: "Registration section",
    items: [
      { key: "sideNote", label: "Note beside the heading (desktop)" },
      { key: "support", label: "Need help? contact (set under Event)" },
      { key: "footerNote", label: "Footer note" },
      { key: "staffLink", label: "Staff login link" },
    ],
  },
];

/** Wording, in page order. `area` makes a two-line box for longer text. */
const TEXTS: { title: string; items: { key: Text; label: string; area?: boolean; required?: boolean }[] }[] = [
  { title: "Hero", items: [
    { key: "heroPricesLabel", label: "Label above the prices" },
    { key: "heroButton", label: "Register button", required: true },
  ] },
  { title: "Registration section", items: [
    { key: "heading", label: "Heading", required: true },
    { key: "sideNote", label: "Note beside the heading", area: true },
  ] },
  { title: "Step 1: choosing tickets", items: [
    { key: "step1Title", label: "Title", required: true },
    { key: "step1Sub", label: "Line under the title", area: true },
  ] },
  { title: "Step 2: vehicle details", items: [
    { key: "step2Title", label: "Title", required: true },
    { key: "step2Sub", label: "Line under the title", area: true },
  ] },
  { title: "Shirt delivery step (tickets that ship a shirt)", items: [
    { key: "shippingTitle", label: "Title", required: true },
    { key: "shippingSub", label: "Line under the title", area: true },
  ] },
  { title: "Total bar", items: [
    { key: "submitButton", label: "Continue button", required: true },
    { key: "payNote", label: "Payment note (with a payment deadline)", area: true },
    { key: "payNoteOpen", label: "Payment note (no payment deadline)", area: true },
    { key: "payNoteTl", label: "Second line (Taglish)", area: true },
  ] },
  { title: "When online sales are closed", items: [
    { key: "closedTitle", label: "Title", required: true },
    { key: "closedText", label: "Message", area: true },
    { key: "closedTextTl", label: "Second line (Taglish)", area: true },
  ] },
  { title: "Footer", items: [{ key: "footerNote", label: "Footer note", area: true }] },
];

/** The "Your details" fields, each with its label, placeholder and hint keys. */
const BUYER_FIELDS: { name: string; label: keyof BuyerFormText; placeholder: keyof BuyerFormText; hint?: keyof BuyerFormText }[] = [
  { name: "Full name", label: "nameLabel", placeholder: "namePlaceholder" },
  { name: "Email", label: "emailLabel", placeholder: "emailPlaceholder", hint: "emailHint" },
  { name: "Confirm email", label: "confirmLabel", placeholder: "confirmPlaceholder", hint: "confirmHint" },
  { name: "Mobile number", label: "mobileLabel", placeholder: "mobilePlaceholder", hint: "mobileHint" },
];

/**
 * Admin > Settings > Page: what the public registration page shows and what it
 * says, from the hero down to the footer. Saved with the other rules; the
 * defaults are the wording the page shipped with.
 */
export function PageForm({ rules }: { rules: Rules }) {
  const router = useRouter();
  const initial = { page: rules.page, buyerForm: rules.buyerForm, terms: rules.terms };
  const [f, setF] = useState(initial);
  const [msg, setMsg] = useState<SaveMsg>(null);
  const [pending, start] = useTransition();
  const dirty = changed(f, initial);
  const atDefaults = !changed(f, { page: PAGE_DEFAULTS, buyerForm: BUYER_FORM_DEFAULTS, terms: TERMS_DEFAULTS });

  const setShow = (k: Show, v: boolean) => setF((p) => ({ ...p, page: { ...p.page, show: { ...p.page.show, [k]: v } } }));
  const setText = (k: Text, v: string) => setF((p) => ({ ...p, page: { ...p.page, [k]: v } }));
  const setBuyer = (k: keyof BuyerFormText, v: string) => setF((p) => ({ ...p, buyerForm: { ...p.buyerForm, [k]: v } }));
  const setTerm = <K extends keyof Terms>(k: K, v: Terms[K]) => setF((p) => ({ ...p, terms: { ...p.terms, [k]: v } }));

  const save = () =>
    start(async () => {
      setMsg(null);
      const r = await saveRulesSection(f);
      setMsg(r.ok ? { kind: "ok", text: "Saved. The registration page shows it on the next load." } : { kind: "err", text: r.error });
      if (r.ok) router.refresh();
    });

  return (
    <div className="card space-y-5">
      <Group
        title="What one registration is called"
        hint="Used on every page, email, PDF and staff screen: “Your registrations are held for 60 minutes”, the number column on tickets, and so on. An event that hands out wristbands would set wristband / wristbands / Wristband no. and ticks the box."
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="tm-one">One</label>
            <input id="tm-one" className="input h-9" maxLength={30} value={f.terms.one} onChange={(e) => setTerm("one", e.target.value)} placeholder="registration" />
          </div>
          <div>
            <label className="label" htmlFor="tm-many">Several</label>
            <input id="tm-many" className="input h-9" maxLength={30} value={f.terms.many} onChange={(e) => setTerm("many", e.target.value)} placeholder="registrations" />
          </div>
          <div>
            <label className="label" htmlFor="tm-number">Its number is called</label>
            <input id="tm-number" className="input h-9" maxLength={40} value={f.terms.numberLabel} onChange={(e) => setTerm("numberLabel", e.target.value)} placeholder="Registration no." />
          </div>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={f.terms.physical} onChange={(e) => setTerm("physical", e.target.checked)} />
          <span>Something is handed over at the gate (e.g. a wristband)<span className="block text-[11px] text-zinc-500">Adds lines like &ldquo;staff will scan it and hand you the matching wristband&rdquo; to tickets and emails. Leave off when the QR code alone is the pass.</span></span>
        </label>
      </Group>

      <Group title="What the page shows" hint="Untick a part to hide it. Parts that come from other tabs (a blank tagline, no sponsors image) stay hidden whatever is ticked here.">
        <div className="grid gap-4 md:grid-cols-3">
          {SWITCHES.map((g) => (
            <fieldset key={g.title} className="rounded-xl border border-white/10 bg-black/20 p-3">
              <legend className="px-1 text-xs font-semibold text-white/80">{g.title}</legend>
              {g.hint && <p className="mb-2 text-[11px] text-zinc-500">{g.hint}</p>}
              <div className="space-y-1.5">
                {g.items.map((it) => (
                  <label key={it.key} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={f.page.show[it.key]} onChange={(e) => setShow(it.key, e.target.checked)} />
                    {it.label}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      </Group>

      <Group
        title="Wording"
        hint={<>Leave an optional line blank to show nothing. Any text here, and in Step 3 below, can use these and they fill themselves in: <code className="rounded bg-black/40 px-1">{"{pay}"}</code> {rules.channels.gotyme.payVia ? `(e.g. "${rules.channels.gotyme.payVia}")` : ""}, <code className="rounded bg-black/40 px-1">{"{via}"}</code> and <code className="rounded bg-black/40 px-1">{"{minutes}"}</code> (the time to pay, now {rules.paymentWindowMinutes}).</>}
      >
        <div className="space-y-3">
          {TEXTS.map((g) => (
            <fieldset key={g.title} className="rounded-xl border border-white/10 bg-black/20 p-3">
              <legend className="px-1 text-xs font-semibold text-white/80">{g.title}</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {g.items.map((it) => (
                  <div key={it.key} className={it.area ? "sm:col-span-2" : ""}>
                    <label className="label" htmlFor={`pg-${it.key}`}>{it.label}{it.required ? "" : " (optional)"}</label>
                    {it.area ? (
                      <textarea id={`pg-${it.key}`} className="input min-h-9" rows={2} maxLength={300} value={f.page[it.key]} onChange={(e) => setText(it.key, e.target.value)} />
                    ) : (
                      <input id={`pg-${it.key}`} className="input h-9" maxLength={60} value={f.page[it.key]} onChange={(e) => setText(it.key, e.target.value)} />
                    )}
                  </div>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      </Group>

      <Group
        title="Step 3: your details"
        hint="The buyer's name, email and mobile. Every field stays required (the form adds the *). A blank placeholder or hint shows nothing. Error messages, such as a mistyped email, are fixed."
      >
        <div className="grid gap-3 sm:grid-cols-[minmax(0,16rem)_1fr]">
          <div>
            <label className="label" htmlFor="bf-title">Step title</label>
            <input id="bf-title" className="input h-9" maxLength={60} value={f.buyerForm.title} onChange={(e) => setBuyer("title", e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="bf-subtitle">Line under the title (optional)</label>
            <textarea id="bf-subtitle" className="input min-h-9" rows={2} maxLength={240} value={f.buyerForm.subtitle} onChange={(e) => setBuyer("subtitle", e.target.value)} />
          </div>
        </div>
        <div className="space-y-3">
          {BUYER_FIELDS.map((fld) => (
            <fieldset key={fld.name} className="rounded-xl border border-white/10 bg-black/20 p-3">
              <legend className="px-1 text-xs font-semibold text-white/80">{fld.name}</legend>
              <div className={`grid gap-3 ${fld.hint ? "sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)_minmax(0,1.4fr)]" : "sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)]"}`}>
                <div>
                  <label className="label" htmlFor={`bf-${fld.label}`}>Label</label>
                  <input id={`bf-${fld.label}`} className="input h-9" maxLength={60} value={f.buyerForm[fld.label]} onChange={(e) => setBuyer(fld.label, e.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor={`bf-${fld.placeholder}`}>Placeholder</label>
                  <input id={`bf-${fld.placeholder}`} className="input h-9" maxLength={60} value={f.buyerForm[fld.placeholder]} onChange={(e) => setBuyer(fld.placeholder, e.target.value)} placeholder="None" />
                </div>
                {fld.hint && (
                  <div>
                    <label className="label" htmlFor={`bf-${fld.hint}`}>Hint under the field</label>
                    <textarea id={`bf-${fld.hint}`} className="input min-h-9" rows={2} maxLength={200} value={f.buyerForm[fld.hint]} onChange={(e) => setBuyer(fld.hint!, e.target.value)} placeholder="None" />
                  </div>
                )}
              </div>
            </fieldset>
          ))}
        </div>
      </Group>

      <SaveBar
        label="Save page"
        dirty={dirty}
        pending={pending}
        msg={msg}
        onSave={save}
        onDiscard={() => { setF(initial); setMsg(null); }}
        extra={
          <button type="button" className="btn-secondary" disabled={pending || atDefaults} onClick={() => { setF({ page: { ...PAGE_DEFAULTS, show: { ...PAGE_DEFAULTS.show } }, buyerForm: { ...BUYER_FORM_DEFAULTS }, terms: { ...TERMS_DEFAULTS } }); setMsg(null); }}>
            Use the original page
          </button>
        }
      />
    </div>
  );
}
