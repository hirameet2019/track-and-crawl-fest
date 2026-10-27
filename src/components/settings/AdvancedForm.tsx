"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveRulesSection } from "@/app/actions/setup";
import { Group, SaveBar, changed, type SaveMsg } from "@/components/settings/SaveBar";
import type { Rules } from "@/lib/rules-types";

/**
 * Settings that are safe to change between events but disruptive during one.
 * Each says what breaks, and saving asks for a confirmation first.
 */
export function AdvancedForm({ rules, locale }: { rules: Rules; locale: { locale: string; timeZone: string; utcOffset: string; currency: string } }) {
  const router = useRouter();
  const initial = { staffUsernameDomain: rules.staffUsernameDomain };
  const [f, setF] = useState(initial);
  const [msg, setMsg] = useState<SaveMsg>(null);
  const [pending, start] = useTransition();
  const dirty = changed(f, initial);

  function save() {
    // Same rules as the server; checked first so nobody confirms a save that then fails.
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(f.staffUsernameDomain)) {
      setMsg({ kind: "err", text: "Domain looks wrong, e.g. staff.local" });
      return;
    }
    const warn: string[] = [];
    if (f.staffUsernameDomain !== initial.staffUsernameDomain) warn.push(`Short-username logins will look for @${f.staffUsernameDomain}. Staff whose accounts end in @${initial.staffUsernameDomain} must type their full email.`);
    if (warn.length && !window.confirm(`${warn.join("\n\n")}\n\nSave anyway?`)) return;
    start(async () => {
      setMsg(null);
      const r = await saveRulesSection(f);
      setMsg(r.ok ? { kind: "ok", text: "Saved." } : { kind: "err", text: r.error });
      if (r.ok) router.refresh();
    });
  }

  return (
    <div className="card space-y-5">
      <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-200">Change these when setting up a new event, not while one is running.</p>

      <Group title="Staff login domain" hint={<>Gate staff sign in with a short username like <code className="rounded bg-black/40 px-1">walkin1</code>; the account behind it is walkin1@this-domain in Supabase Auth.</>}>
        <input className="input max-w-xs font-mono" value={f.staffUsernameDomain} onChange={(e) => setF((p) => ({ ...p, staffUsernameDomain: e.target.value.trim().toLowerCase() }))} spellCheck={false} aria-label="Staff login domain" />
      </Group>


      <Group title="Locale" hint="Built into every screen, so it is changed in code (src/config/site.ts) by a developer.">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <div><dt className="text-xs text-zinc-500">Language</dt><dd className="font-mono">{locale.locale}</dd></div>
          <div><dt className="text-xs text-zinc-500">Time zone</dt><dd className="font-mono">{locale.timeZone}</dd></div>
          <div><dt className="text-xs text-zinc-500">UTC offset</dt><dd className="font-mono">{locale.utcOffset}</dd></div>
          <div><dt className="text-xs text-zinc-500">Currency</dt><dd className="font-mono">{locale.currency}</dd></div>
        </dl>
      </Group>

      <SaveBar label="Save advanced" dirty={dirty} pending={pending} msg={msg} onSave={save} onDiscard={() => { setF(initial); setMsg(null); }} />
    </div>
  );
}
