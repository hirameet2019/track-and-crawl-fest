"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveRulesSection } from "@/app/actions/setup";
import { Group, SaveBar, changed, type SaveMsg } from "@/components/settings/SaveBar";
import { PAY_PAGE_DEFAULTS, type PayPageSettings, type Rules } from "@/lib/rules-types";

type Show = keyof PayPageSettings["show"];
type Text = Exclude<keyof PayPageSettings, "show">;

const SWITCHES: { key: Show; label: string }[] = [
  { key: "holdNote", label: "Order number, hold time and countdown" },
  { key: "holdWarning", label: "\"Pay before the timer ends\" warning" },
  { key: "summary", label: "Order summary" },
  { key: "accountName", label: "Account name on each channel" },
  { key: "accountNumber", label: "Account number on each channel" },
  { key: "exactCallout", label: "\"Pay exactly\" reminder" },
  { key: "referenceHelp", label: "\"Where do I find the reference number?\" help" },
  { key: "afterSubmit", label: "\"After you submit\" box" },
  { key: "support", label: "Need help? contact (set under Event)" },
];

/** Wording, top to bottom. `area` makes a box for longer text; `required` may not be blank. */
const TEXTS: { title: string; items: { key: Text; label: string; area?: boolean; required?: boolean }[] }[] = [
  { title: "Top of the page", items: [
    { key: "title", label: "Title", required: true },
    { key: "holdNote", label: "Hold note ({timeLeft} is the live countdown)", area: true },
    { key: "holdWarning", label: "Warning", area: true },
    { key: "holdWarningTl", label: "Warning, second line (Taglish)", area: true },
  ] },
  { title: "Order summary", items: [
    { key: "summaryTitle", label: "Title", required: true },
    { key: "totalLabel", label: "Total row", required: true },
  ] },
  { title: "Step 1: paying", items: [
    { key: "step1Title", label: "Title", required: true },
    { key: "step1Text", label: "Instructions", area: true },
    { key: "step1TextTl", label: "Instructions (Taglish)", area: true },
    { key: "exactCallout", label: "\"Pay exactly\" reminder", area: true },
    { key: "exactCalloutTl", label: "Reminder, second line (Taglish)", area: true },
  ] },
  { title: "Step 2: proof of payment", items: [
    { key: "step2Title", label: "Title", required: true },
    { key: "step2Text", label: "Instructions", area: true },
    { key: "step2TextTl", label: "Instructions (Taglish)", area: true },
    { key: "methodLabel", label: "\"I paid with\" label", required: true },
    { key: "onlyOneNote", label: "Note when only one channel is offered ({app} is its name)" },
    { key: "referenceLabel", label: "Reference number label", required: true },
    { key: "referencePlaceholder", label: "Reference number placeholder" },
    { key: "referenceHint", label: "Reference number hint", area: true },
    { key: "referenceHelpTitle", label: "Help link text" },
    { key: "referenceHelpText", label: "Help text", area: true },
    { key: "referenceHelpTextTl", label: "Help text (Taglish)", area: true },
    { key: "screenshotLabel", label: "Screenshot label", required: true },
    { key: "screenshotHint", label: "Screenshot hint", area: true },
    { key: "submitButton", label: "Submit button", required: true },
  ] },
  { title: "After you submit", items: [
    { key: "afterTitle", label: "Title" },
    { key: "afterText", label: "First paragraph", area: true },
    { key: "afterText2", label: "Second paragraph ({statusLink} is the order status link)", area: true },
    { key: "afterTextTl", label: "Taglish line", area: true },
  ] },
];

/** Admin > Settings > Payment page: what /pay/<order> shows and says. Saved with the other rules. */
export function PayPageForm({ rules }: { rules: Rules }) {
  const router = useRouter();
  const initial = rules.payPage;
  const [f, setF] = useState<PayPageSettings>(initial);
  const [msg, setMsg] = useState<SaveMsg>(null);
  const [pending, start] = useTransition();
  const dirty = changed(f, initial);
  const atDefaults = !changed(f, PAY_PAGE_DEFAULTS);

  const save = () =>
    start(async () => {
      setMsg(null);
      const r = await saveRulesSection({ payPage: f });
      setMsg(r.ok ? { kind: "ok", text: "Saved. Payment pages show it on the next load." } : { kind: "err", text: r.error });
      if (r.ok) router.refresh();
    });

  return (
    <div className="card space-y-5">
      <Group title="What the page shows" hint="Untick a part to hide it. The channels themselves (QR codes, account details) are set under Payments.">
        <div className="grid gap-1.5 sm:grid-cols-2">
          {SWITCHES.map((it) => (
            <label key={it.key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f.show[it.key]} onChange={(e) => setF((p) => ({ ...p, show: { ...p.show, [it.key]: e.target.checked } }))} />
              {it.label}
            </label>
          ))}
        </div>
      </Group>

      <Group
        title="Wording"
        hint={
          <>
            Leave an optional line blank to show nothing. <b className="text-white/70">**Double asterisks**</b> make bold. These fill themselves in:{" "}
            {["{amount}", "{order}", "{name}", "{email}", "{minutes}", "{app}", "{scanHint}"].map((tok, i) => (
              <span key={tok}>{i ? ", " : ""}<code className="rounded bg-black/40 px-1">{tok}</code></span>
            ))}
            .
          </>
        }
      >
        <div className="space-y-3">
          {TEXTS.map((g) => (
            <fieldset key={g.title} className="rounded-xl border border-white/10 bg-black/20 p-3">
              <legend className="px-1 text-xs font-semibold text-white/80">{g.title}</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {g.items.map((it) => (
                  <div key={it.key} className={it.area ? "sm:col-span-2" : ""}>
                    <label className="label" htmlFor={`pp-${it.key}`}>{it.label}{it.required ? "" : " (optional)"}</label>
                    {it.area ? (
                      <textarea id={`pp-${it.key}`} className="input min-h-9" rows={2} maxLength={500} value={f[it.key]} onChange={(e) => setF((p) => ({ ...p, [it.key]: e.target.value }))} />
                    ) : (
                      <input id={`pp-${it.key}`} className="input h-9" maxLength={120} value={f[it.key]} onChange={(e) => setF((p) => ({ ...p, [it.key]: e.target.value }))} />
                    )}
                  </div>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      </Group>

      <SaveBar
        label="Save payment page"
        dirty={dirty}
        pending={pending}
        msg={msg}
        onSave={save}
        onDiscard={() => { setF(initial); setMsg(null); }}
        extra={
          <button type="button" className="btn-secondary" disabled={pending || atDefaults} onClick={() => { setF({ ...PAY_PAGE_DEFAULTS, show: { ...PAY_PAGE_DEFAULTS.show } }); setMsg(null); }}>
            Use the original wording
          </button>
        }
      />
    </div>
  );
}
