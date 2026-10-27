"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resetSiteSettingsAction, saveSiteSettingsAction } from "@/app/actions/setup";
import { AssetField } from "@/components/AssetField";
import type { HeroSlide } from "@/config/site";
import type { PdfSlot, SiteSettings } from "@/lib/site-settings";
import { SaveBar, changed, type SaveMsg } from "@/components/settings/SaveBar";

const NEON: { key: keyof SiteSettings["theme"]["neon"]; label: string }[] = [
  { key: "pink", label: "Accent 1" },
  { key: "violet", label: "Accent 2" },
  { key: "cyan", label: "Accent 3" },
  { key: "green", label: "Accent 4" },
];
const BASE: { key: "background" | "backgroundDeep" | "browserChrome"; label: string; hint: string }[] = [
  { key: "background", label: "Page background", hint: "Behind the hero and the staff screens" },
  { key: "backgroundDeep", label: "Background glow", hint: "Top of the gradient while artwork loads" },
  { key: "browserChrome", label: "Phone browser bar", hint: "Address-bar colour on phones" },
];
const FOCUS = ["center top", "center 35%", "center center", "center 65%", "center bottom"];

/** PDF colour slots, with the built-in colour each one falls back to (approximate hex). */
const PDF_COLORS: { key: PdfSlot; label: string; builtIn: string }[] = [
  { key: "pink", label: "Accent 1 (stripe, text logo line 1)", builtIn: "#ff5ed9" },
  { key: "violet", label: "Accent 2 (stripe)", builtIn: "#b34dff" },
  { key: "cyan", label: "Accent 3 (stripe, ticket badges)", builtIn: "#29d9ff" },
  { key: "green", label: "Accent 4 (stripe, text logo line 2)", builtIn: "#5cfc7a" },
  { key: "gold", label: "VIP badges and logo rule", builtIn: "#ffd140" },
  { key: "pinkDark", label: "Line 1 outline", builtIn: "#4a054f" },
  { key: "teal", label: "Line 2 outline", builtIn: "#05363b" },
  { key: "goldDark", label: "Gold outline", builtIn: "#3b2400" },
];
const MAX_SLIDES = 8;

function ColorInput({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  const valid = /^#[0-9a-f]{6}$/i.test(value);
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex items-center gap-2">
        <input type="color" className="h-9 w-11 shrink-0 cursor-pointer rounded border border-white/15 bg-transparent" value={valid ? value : "#000000"} onChange={(e) => onChange(e.target.value)} aria-label={`${label} picker`} />
        <input className={`input h-9 font-mono text-xs ${valid ? "" : "border-red-400"}`} value={value} onChange={(e) => onChange(e.target.value.trim())} spellCheck={false} />
      </div>
      {hint && <p className="mt-1 text-[11px] text-zinc-500">{hint}</p>}
    </div>
  );
}

/**
 * Admin > Settings > Look of the site. Edits one SiteSettings object and saves
 * it whole; "Back to defaults" removes the saved value so src/config/site.ts
 * shows again.
 */
export function SiteLookForm({ current, defaults, customised }: { current: SiteSettings; defaults: SiteSettings; customised: boolean }) {
  const router = useRouter();
  const [s, setS] = useState<SiteSettings>(current);
  const [msg, setMsg] = useState<SaveMsg>(null);
  const [pending, start] = useTransition();
  const dirty = changed(s, current);

  const set = <K extends keyof SiteSettings>(k: K, v: SiteSettings[K]) => setS((p) => ({ ...p, [k]: v }));
  const setPdfColor = (k: PdfSlot, v: string | null) =>
    setS((p) => {
      const next = { ...p.pdfPalette };
      if (v) next[k] = v; else delete next[k];
      return { ...p, pdfPalette: next };
    });
  const setHero = (patch: Partial<SiteSettings["hero"]>) => setS((p) => ({ ...p, hero: { ...p.hero, ...patch } }));
  const setTheme = (patch: Partial<SiteSettings["theme"]>) => setS((p) => ({ ...p, theme: { ...p.theme, ...patch } }));
  const setSlide = (i: number, patch: Partial<HeroSlide>) => setHero({ slides: s.hero.slides.map((sl, j) => (j === i ? { ...sl, ...patch } : sl)) });
  const moveSlide = (i: number, d: -1 | 1) => {
    const next = [...s.hero.slides];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setHero({ slides: next });
  };

  function save() {
    setMsg(null);
    start(async () => {
      const r = await saveSiteSettingsAction(s);
      setMsg(r.ok ? { kind: "ok", text: "Saved. The site shows the new look on the next page load." } : { kind: "err", text: r.error });
      if (r.ok) router.refresh();
    });
  }
  function reset() {
    if (!window.confirm("Put every look setting back to the built-in defaults? Uploaded files stay in storage but are no longer used.")) return;
    setMsg(null);
    start(async () => {
      const r = await resetSiteSettingsAction();
      if (r.ok) { setS(defaults); router.refresh(); }
      setMsg(r.ok ? { kind: "ok", text: "Back to the built-in defaults." } : { kind: "err", text: r.error });
    });
  }

  return (
    <div className="card space-y-6">
      <p className="text-xs text-zinc-500">{customised ? "Showing your saved look." : "Showing the built-in look; nothing saved yet."}</p>

      {/* ---------------------------------------------------------- brand */}
      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-white/90">Title and images</h3>
        <div>
          <label className="label">Browser tab suffix</label>
          <input className="input" value={s.titleSuffix} onChange={(e) => set("titleSuffix", e.target.value)} placeholder="Tickets" maxLength={40} />
          <p className="mt-1 text-xs text-zinc-500">The tab reads &ldquo;Event name · {s.titleSuffix || "…"}&rdquo;. The event name comes from Event details.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <AssetField label="Logo" value={s.logo} onChange={(v) => set("logo", v)} hint="Transparent PNG works best. Blank sets the event name in type. Hero, page banner, login, staff bar." />
          <AssetField label="Backdrop" value={s.backdrop} onChange={(v) => set("backdrop", v)} hint="Washed behind the payment, order, login and staff pages." />
          <AssetField label="Share image" value={s.shareImage} onChange={(v) => set("shareImage", v)} hint="Preview when the link is shared on Facebook, Messenger, Viber. About 1200 x 630." />
        </div>
      </section>

      {/* ---------------------------------------------------------- hero */}
      <section className="space-y-4 border-t border-white/10 pt-5">
        <h3 className="text-sm font-semibold text-white/90">Sales page slideshow</h3>
        <ol className="space-y-3">
          {s.hero.slides.map((sl, i) => (
            <li key={i} className="rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">Slide {i + 1}</span>
                <div className="flex gap-1">
                  <button type="button" className="btn-secondary px-2 py-0.5 text-xs" disabled={i === 0} onClick={() => moveSlide(i, -1)} aria-label="Move up">&uarr;</button>
                  <button type="button" className="btn-secondary px-2 py-0.5 text-xs" disabled={i === s.hero.slides.length - 1} onClick={() => moveSlide(i, 1)} aria-label="Move down">&darr;</button>
                  <button type="button" className="btn-secondary px-2 py-0.5 text-xs" disabled={s.hero.slides.length === 1} onClick={() => setHero({ slides: s.hero.slides.filter((_, j) => j !== i) })}>Remove</button>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <AssetField label="Image" value={sl.src} onChange={(v) => setSlide(i, { src: v })} hint={sl.video ? "Shown while the video loads, and to anyone who turned off motion." : "About 1600-2000 px wide."} />
                <AssetField label="Video (optional)" kind="video" value={sl.video ?? ""} onChange={(v) => setSlide(i, { video: v || undefined })} onClear={() => setSlide(i, { video: undefined })} hint="Short, silent, under ~5 MB. Plays muted on loop." />
                <div>
                  <label className="label">Label (for screen readers)</label>
                  <input className="input h-9" value={sl.label} onChange={(e) => setSlide(i, { label: e.target.value })} maxLength={60} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="label">Focus point</label>
                    <input className="input h-9" list="slide-focus" value={sl.position ?? ""} onChange={(e) => setSlide(i, { position: e.target.value || undefined })} placeholder="center center" />
                  </div>
                  <div>
                    <label className="label">Fit</label>
                    <select className="input h-9" value={sl.size ?? "cover"} onChange={(e) => setSlide(i, { size: e.target.value === "contain" ? "contain" : undefined })}>
                      <option value="cover">Fill (crop)</option>
                      <option value="contain">Whole image</option>
                    </select>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ol>
        <datalist id="slide-focus">{FOCUS.map((f) => <option key={f} value={f} />)}</datalist>
        <button type="button" className="btn-secondary text-sm" disabled={s.hero.slides.length >= MAX_SLIDES} onClick={() => setHero({ slides: [...s.hero.slides, { src: "", label: `slide ${s.hero.slides.length + 1}` }] })}>
          + Add slide
        </button>
        <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
          <div>
            <label className="label">Seconds per slide</label>
            <input className="input h-9" type="number" min={3} max={30} value={Math.round(s.hero.intervalMs / 1000)} onChange={(e) => setHero({ intervalMs: Math.round(Number(e.target.value) * 1000) || 0 })} />
          </div>
          <div>
            <span className="label">Effects over the artwork</span>
            <div className="flex flex-wrap gap-4 pt-1 text-sm">
              {(["glow", "smoke", "streaks"] as const).map((k) => (
                <label key={k} className="flex items-center gap-2">
                  <input type="checkbox" checked={s.hero.effects[k]} onChange={(e) => setHero({ effects: { ...s.hero.effects, [k]: e.target.checked } })} />
                  {k === "glow" ? "Neon glow" : k === "smoke" ? "Smoke" : "Speed streaks"}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-zinc-500">Smoke and streaks suit motorsport; turn them off for other events.</p>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- colours */}
      <section className="space-y-4 border-t border-white/10 pt-5">
        <h3 className="text-sm font-semibold text-white/90">Colours</h3>
        <div
          className="h-3 rounded-full"
          style={{ backgroundImage: `linear-gradient(90deg, ${s.theme.neon.pink}, ${s.theme.neon.violet}, ${s.theme.neon.cyan}, ${s.theme.neon.green})` }}
          aria-hidden
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {NEON.map((n) => (
            <ColorInput key={n.key} label={n.label} value={s.theme.neon[n.key]} onChange={(v) => setTheme({ neon: { ...s.theme.neon, [n.key]: v } })} />
          ))}
        </div>
        <p className="text-xs text-zinc-500">The four accents run left to right in buttons, glows, underlines and the stripe on tickets.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {BASE.map((b) => (
            <ColorInput key={b.key} label={b.label} hint={b.hint} value={s.theme[b.key]} onChange={(v) => setTheme({ [b.key]: v })} />
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------------- pdf */}
      <section className="space-y-4 border-t border-white/10 pt-5">
        <h3 className="text-sm font-semibold text-white/90">PDF ticket</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <AssetField label="Ticket logo" kind="pdf" value={s.pdfLogo ?? ""} onChange={(v) => set("pdfLogo", v || null)} onClear={() => set("pdfLogo", null)} defaultLabel="Built-in logo" hint="PNG or JPG. Blank keeps the built-in logo." />
          <AssetField label="Ticket banner" kind="pdf" value={s.pdfBanner ?? ""} onChange={(v) => set("pdfBanner", v || null)} onClear={() => set("pdfBanner", null)} defaultLabel="Built-in banner" hint="Photo across the top of each ticket. PNG or JPG." />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-white/75">Ticket colours</span>
          <button
            type="button"
            className="btn-secondary px-3 py-1 text-xs"
            onClick={() => setS((p) => ({ ...p, pdfPalette: { ...p.pdfPalette, pink: p.theme.neon.pink, violet: p.theme.neon.violet, cyan: p.theme.neon.cyan, green: p.theme.neon.green } }))}
          >
            Use the site accents
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {PDF_COLORS.map((c) => {
            const v = s.pdfPalette[c.key];
            return (
              <div key={c.key} className="flex items-center gap-2">
                <input type="color" className="h-8 w-10 shrink-0 cursor-pointer rounded border border-white/15 bg-transparent" value={v ?? c.builtIn} onChange={(e) => setPdfColor(c.key, e.target.value)} aria-label={`${c.label} colour`} />
                <span className="min-w-0 flex-1 text-xs text-zinc-400">{c.label}</span>
                {v ? (
                  <button type="button" className="text-xs text-zinc-400 underline hover:text-white" onClick={() => setPdfColor(c.key, null)}>Built-in</button>
                ) : (
                  <span className="text-[11px] text-zinc-600">built-in</span>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ---------------------------------------------------------- info */}
      <section className="space-y-4 border-t border-white/10 pt-5">
        <h3 className="text-sm font-semibold text-white/90">Event information block</h3>
        <p className="text-xs text-zinc-500">Shown under the hero, before the registration form. Date, venue and tagline come from Event details.</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="info-end">Ends at</label>
            <input id="info-end" type="time" className="input" value={s.info.endTime} onChange={(e) => set("info", { ...s.info, endTime: e.target.value })} />
            <p className="mt-1 text-xs text-zinc-500">Blank shows the start time only.</p>
          </div>
          <AssetField label="Presented by" value={s.info.presentedBy} onChange={(v) => set("info", { ...s.info, presentedBy: v })} hint="Strip of presenter logos. Blank hides the row." />
          <AssetField label="Sponsors" value={s.info.sponsors} onChange={(v) => set("info", { ...s.info, sponsors: v })} hint="Sponsor logo strip. Blank hides it." />
        </div>
      </section>

      {/* ---------------------------------------------------------- note */}
      <section className="space-y-2 border-t border-white/10 pt-5">
        <h3 className="text-sm font-semibold text-white/90">Note above the sales schedule</h3>
        <textarea className="input min-h-20" value={s.salesScheduleNote ?? ""} onChange={(e) => set("salesScheduleNote", e.target.value || null)} maxLength={600} placeholder="Optional: the organizer's cut-off schedule, for staff" />
      </section>

      <SaveBar
        label="Save look"
        dirty={dirty}
        pending={pending}
        msg={msg}
        onSave={save}
        onDiscard={() => { setS(current); setMsg(null); }}
        extra={customised ? <button type="button" className="btn-secondary" disabled={pending} onClick={reset}>Back to defaults</button> : undefined}
      />
    </div>
  );
}
