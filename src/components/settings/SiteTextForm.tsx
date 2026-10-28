"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveRulesSection } from "@/app/actions/setup";
import { Group, SaveBar, changed, type SaveMsg } from "@/components/settings/SaveBar";
import { MAX_TEXT_LENGTH, SITE_TEXT, TEXT_GROUPS, type SiteTextKey, type TextDef, type TextOverrides } from "@/lib/site-text";

const KEYS = Object.keys(SITE_TEXT) as SiteTextKey[];
const def = (k: SiteTextKey) => SITE_TEXT[k] as TextDef;

/**
 * Settings > Website text: every fixed sentence, label and button on the public
 * pages, grouped by page. Each box starts with the wording the page shows now.
 * Only texts that differ from the default are saved, so later improvements to
 * the defaults still reach the rest; Reset puts one back.
 */
export function SiteTextForm({ current }: { current: TextOverrides }) {
  const router = useRouter();
  const [v, setV] = useState<TextOverrides>(current);
  const [q, setQ] = useState("");
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [msg, setMsg] = useState<SaveMsg>(null);
  const [pending, start] = useTransition();
  const dirty = changed(v, current);

  /**
   * Store a text only when it differs from the default. An emptied box stays empty
   * while typing; the page shows the default for an empty required text.
   */
  function set(k: SiteTextKey, value: string) {
    setV((p) => {
      const n = { ...p };
      if (value === def(k).text) delete n[k];
      else n[k] = value;
      return n;
    });
  }
  function reset(k: SiteTextKey) {
    setV((p) => {
      const n = { ...p };
      delete n[k];
      return n;
    });
  }

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return KEYS.filter((k) => {
      if (onlyChanged && v[k] === undefined) return false;
      if (!needle) return true;
      const d = def(k);
      return [d.label, d.text, d.group, v[k] ?? ""].some((s) => s.toLowerCase().includes(needle));
    });
  }, [q, onlyChanged, v]);
  const changedCount = Object.keys(v).length;

  function save() {
    setMsg(null);
    start(async () => {
      const r = await saveRulesSection({ text: v });
      setMsg(r.ok ? { kind: "ok", text: "Saved. The pages show the new wording on the next load." } : { kind: "err", text: r.error });
      if (r.ok) router.refresh();
    });
  }

  return (
    <div className="card space-y-6">
      <div className="space-y-3">
        <p className="text-xs text-zinc-500">
          Every box shows what the page says now. Words in braces such as <code className="rounded bg-black/40 px-1">{"{date}"}</code> are filled in by the page: keep them where the
          value should go. <code className="rounded bg-black/40 px-1">**bold**</code> makes text bold and <code className="rounded bg-black/40 px-1">[link text](/)</code> makes a link.
          Headings, steps and notes that already have their own tab (Page, Payment page) stay there.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input className="input h-9 max-w-xs" type="search" placeholder="Find a text, e.g. sold out" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a text" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} />
            Only changed ({changedCount})
          </label>
          <span className="text-xs text-zinc-500">{shown.length} of {KEYS.length} texts</span>
        </div>
      </div>

      {TEXT_GROUPS.map((g) => {
        const keys = shown.filter((k) => def(k).group === g);
        if (!keys.length) return null;
        return (
          <Group key={g} title={g}>
            <div className="space-y-4">
              {keys.map((k) => {
                const d = def(k);
                const own = v[k];
                const value = own ?? d.text;
                const id = `text-${k.replace(/\./g, "-")}`;
                return (
                  <div key={k}>
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                      <label className="label !mb-0" htmlFor={id}>
                        {d.label}
                        {own !== undefined && <span className="ml-2 rounded bg-cyan-400/15 px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-cyan-200">Changed</span>}
                      </label>
                      {own !== undefined && (
                        <button type="button" className="text-xs text-zinc-400 underline hover:text-white" onClick={() => reset(k)}>Reset to default</button>
                      )}
                    </div>
                    {d.long ? (
                      <textarea id={id} className="input min-h-20" value={value} maxLength={MAX_TEXT_LENGTH} onChange={(e) => set(k, e.target.value)} />
                    ) : (
                      <input id={id} className="input h-9" value={value} maxLength={MAX_TEXT_LENGTH} onChange={(e) => set(k, e.target.value)} />
                    )}
                    <div className="mt-1 space-y-0.5 text-[11px] leading-snug text-zinc-500">
                      {d.vars && (
                        <p>
                          Fills in:{" "}
                          {Object.entries(d.vars).map(([name, what], i) => (
                            <span key={name}>{i > 0 && " · "}<code className="text-white/70">{`{${name}}`}</code> {what}</span>
                          ))}
                        </p>
                      )}
                      {value === "" && (d.optional
                        ? <p className="text-amber-300">Hidden on the page. Reset to show it again.</p>
                        : <p className="text-amber-300">This one cannot be blank: the page shows the default.</p>)}
                      {own !== undefined && own !== "" && <p>Default: {d.text || "(hidden)"}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </Group>
        );
      })}
      {!shown.length && <p className="py-6 text-center text-sm text-zinc-500">No text matches &ldquo;{q}&rdquo;.</p>}

      <SaveBar label="Save website text" dirty={dirty} pending={pending} msg={msg} onSave={save} onDiscard={() => { setV(current); setMsg(null); }} />
    </div>
  );
}
