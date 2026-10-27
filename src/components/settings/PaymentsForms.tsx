"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { savePaymentQr, saveRulesSection, type PaymentQrInput, type PaymentQrValues } from "@/app/actions/setup";
import { AssetField } from "@/components/AssetField";
import { ONLINE_CHANNELS } from "@/config/event";
import { Group, NumberField, SaveBar, changed, type SaveMsg } from "@/components/settings/SaveBar";
import { MAX_EXTRA_CHANNELS, cap, type ExtraChannel, type Rules } from "@/lib/rules-types";
import type { PaymentMethod } from "@/lib/supabase/types";

const toQr = (e: PaymentQrValues): PaymentQrInput => ({
  gotyme_qr_url: e.gotyme_qr_url ?? "",
  gotyme_account_name: e.gotyme_account_name ?? "",
  gcash_qr_url: e.gcash_qr_url ?? "",
  gcash_account_name: e.gcash_account_name ?? "",
  maya_qr_url: e.maya_qr_url ?? "",
  maya_account_name: e.maya_account_name ?? "",
});

/** QR codes and account names on the events row. A channel with a QR is offered to buyers. */
export function PaymentQrForm({ event, channels }: { event: PaymentQrValues; channels: Rules["channels"] }) {
  const router = useRouter();
  const initial = toQr(event);
  const [f, setF] = useState<PaymentQrInput>(initial);
  const [msg, setMsg] = useState<SaveMsg>(null);
  const [pending, start] = useTransition();
  const dirty = changed(f, initial);
  const primary = ONLINE_CHANNELS.find((k) => f[`${k}_qr_url`]);

  const save = () =>
    start(async () => {
      setMsg(null);
      const r = await savePaymentQr(f);
      setMsg(r.ok ? { kind: "ok", text: "Saved. The payment page shows these on the next load." } : { kind: "err", text: r.error });
      if (r.ok) router.refresh();
    });

  return (
    <div className="card space-y-5">
      <div>
        <h2 className="font-semibold">Payment QR codes</h2>
        <p className="text-sm text-zinc-500">
          Buyers can pay with any channel that has a QR. Instructions name the first one{primary ? <>, now <b className="text-white/75">{channels[primary].label}</b></> : null}.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {ONLINE_CHANNELS.map((k) => (
          <div key={k} className="space-y-3 rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="text-sm font-semibold">{channels[k].label}</div>
            <AssetField label="QR code" value={String(f[`${k}_qr_url`] ?? "")} onChange={(v) => setF((p) => ({ ...p, [`${k}_qr_url`]: v }))} onClear={() => setF((p) => ({ ...p, [`${k}_qr_url`]: "" }))} defaultLabel="Off" />
            <div>
              <label className="label">Account name</label>
              <input className="input h-9" maxLength={120} value={String(f[`${k}_account_name`] ?? "")} onChange={(e) => setF((p) => ({ ...p, [`${k}_account_name`]: e.target.value }))} />
            </div>
          </div>
        ))}
      </div>
      <SaveBar label="Save QR codes" dirty={dirty} pending={pending} msg={msg} onSave={save} onDiscard={() => { setF(initial); setMsg(null); }} />
    </div>
  );
}

/** "BPI bank transfer" -> "bpi-bank-transfer", made unique against the others. */
function channelId(label: string, taken: string[]): string {
  const base = label.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "channel";
  const reserved = ["gotyme", "gcash", "maya", "cash", "other", ...taken];
  let id = base.length < 2 ? `${base}-pay` : base;
  for (let n = 2; reserved.includes(id); n++) id = `${base}-${n}`;
  return id;
}

const blankChannel = (taken: string[]): ExtraChannel => ({
  id: channelId("new channel", taken),
  enabled: true,
  label: "",
  app: "",
  via: "",
  payVia: "",
  qrUrl: null,
  accountName: "",
  accountNumber: "",
  hint: "",
  referenceImage: null,
});

/**
 * Payment channels beyond GoTyme / GCash / Maya: bank transfers, other e-wallets.
 * Each shows on the payment page (after the built-in ones, in this order) while it
 * is switched on and has a QR or an account number. Orders paid through one keep
 * its name, so renaming or removing it later does not rewrite history.
 */
export function ExtraChannelsForm({ rules }: { rules: Rules }) {
  const router = useRouter();
  const initial = rules.extraChannels;
  const [list, setList] = useState<ExtraChannel[]>(initial);
  const [msg, setMsg] = useState<SaveMsg>(null);
  const [pending, start] = useTransition();
  const dirty = changed(list, initial);
  const saved = new Set(initial.map((c) => c.id));

  const set = (i: number, patch: Partial<ExtraChannel>) =>
    setList((p) =>
      p.map((c, j) => {
        if (j !== i) return c;
        const next = { ...c, ...patch };
        // A new channel takes its id from its name until it is saved; after that the id is fixed.
        if (patch.label !== undefined && !saved.has(c.id)) next.id = channelId(patch.label || "new channel", p.filter((_, k) => k !== i).map((x) => x.id));
        return next;
      }),
    );
  const move = (i: number, d: -1 | 1) =>
    setList((p) => {
      const n = [...p];
      [n[i], n[i + d]] = [n[i + d], n[i]];
      return n;
    });

  const save = () =>
    start(async () => {
      setMsg(null);
      const r = await saveRulesSection({ extraChannels: list });
      setMsg(r.ok ? { kind: "ok", text: "Saved. The payment page offers these on the next load." } : { kind: "err", text: r.error });
      if (r.ok) router.refresh();
    });

  return (
    <div className="card space-y-5">
      <div>
        <h2 className="font-semibold">More payment channels</h2>
        <p className="text-sm text-zinc-500">
          Bank transfers or other e-wallets, shown after the QR codes above. A channel is offered while it is switched on and has a QR or an account number.
          Staff see its name on Verify, Orders, receipts and exports.
        </p>
      </div>

      {list.length === 0 && <p className="rounded-xl border border-dashed border-white/15 p-4 text-center text-sm text-zinc-500">None yet. Only the channels above are offered.</p>}

      <ol className="space-y-3">
        {list.map((c, i) => (
          // Index key: a new channel's id follows its name as it is typed, and remounting would drop focus.
          <li key={i} className={`rounded-xl border p-3 ${c.enabled ? "border-white/15 bg-black/25" : "border-white/10 bg-black/10 opacity-80"}`}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" checked={c.enabled} onChange={(e) => set(i, { enabled: e.target.checked })} />
                {c.label || "New channel"}
                <span className="font-mono text-[11px] font-normal text-zinc-500">{c.id}</span>
                {!c.enabled && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-normal">off</span>}
              </label>
              <div className="flex gap-1">
                <button type="button" className="btn-secondary px-2 py-0.5 text-xs" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${c.label || "channel"} up`}>&uarr;</button>
                <button type="button" className="btn-secondary px-2 py-0.5 text-xs" disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${c.label || "channel"} down`}>&darr;</button>
                <button type="button" className="btn-secondary px-2 py-0.5 text-xs" onClick={() => setList((p) => p.filter((_, j) => j !== i))}>Remove</button>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className="label">Full name *</label><input className="input h-9" maxLength={60} value={c.label} placeholder="BPI bank transfer" onChange={(e) => set(i, { label: e.target.value })} /></div>
              <div><label className="label">Short name *</label><input className="input h-9" maxLength={30} value={c.app} placeholder="BPI" onChange={(e) => set(i, { app: e.target.value })} /></div>
              <div><label className="label">&ldquo;Pay via&rdquo; on the order form *</label><input className="input h-9" maxLength={60} value={c.via} placeholder="BPI transfer" onChange={(e) => set(i, { via: e.target.value })} /></div>
              <div><label className="label">&ldquo;Pay via&rdquo; in page text and emails *</label><input className="input h-9" maxLength={80} value={c.payVia} placeholder="BPI bank transfer" onChange={(e) => set(i, { payVia: e.target.value })} /></div>
              <div><label className="label">Account name</label><input className="input h-9" maxLength={120} value={c.accountName} onChange={(e) => set(i, { accountName: e.target.value })} /></div>
              <div><label className="label">Account number</label><input className="input h-9 font-mono" maxLength={60} value={c.accountNumber} onChange={(e) => set(i, { accountNumber: e.target.value })} /></div>
              <div className="sm:col-span-2"><label className="label">Note under the QR / account</label><input className="input h-9" maxLength={240} value={c.hint} placeholder="e.g. InstaPay or PESONet from any bank" onChange={(e) => set(i, { hint: e.target.value })} /></div>
              <AssetField label="QR code" value={c.qrUrl ?? ""} onChange={(v) => set(i, { qrUrl: v || null })} onClear={() => set(i, { qrUrl: null })} defaultLabel="No QR" hint="Optional when an account number is given." />
              <AssetField label="Where to find the reference number" value={c.referenceImage ?? ""} onChange={(v) => set(i, { referenceImage: v || null })} onClear={() => set(i, { referenceImage: null })} defaultLabel="None" hint="Screenshot shown under the proof-of-payment form." />
            </div>
          </li>
        ))}
      </ol>

      <button type="button" className="btn-secondary text-sm" disabled={list.length >= MAX_EXTRA_CHANNELS} onClick={() => setList((p) => [...p, blankChannel(p.map((x) => x.id))])}>
        + Add payment channel
      </button>

      <SaveBar label="Save channels" dirty={dirty} pending={pending} msg={msg} onSave={save} onDiscard={() => { setList(initial); setMsg(null); }} />
    </div>
  );
}

const CHANNEL_ORDER: PaymentMethod[] = ["gotyme", "gcash", "maya", "cash"];

/** How long buyers have to pay, the reminder, and the wording used for each channel. */
export function PaymentRulesForm({ rules }: { rules: Rules }) {
  const router = useRouter();
  const pick = (r: Rules) => ({
    paymentDeadline: r.paymentDeadline,
    paymentWindowMinutes: r.paymentWindowMinutes,
    paymentReminder: r.paymentReminder,
    reminderMinutes: r.reminderMinutes,
    expiryNoticeMaxAgeHours: r.expiryNoticeMaxAgeHours,
    channels: r.channels,
  });
  const initial = pick(rules);
  const [f, setF] = useState(initial);
  const [msg, setMsg] = useState<SaveMsg>(null);
  const [pending, start] = useTransition();
  const dirty = changed(f, initial);
  const setCh = (k: PaymentMethod, patch: Partial<Rules["channels"][PaymentMethod]>) =>
    setF((p) => ({ ...p, channels: { ...p.channels, [k]: { ...p.channels[k], ...patch } } }));
  const opt = (v: string) => (v.trim() ? v : undefined);

  const save = () =>
    start(async () => {
      setMsg(null);
      const r = await saveRulesSection(f);
      setMsg(r.ok ? { kind: "ok", text: "Saved. New orders and emails use these right away." } : { kind: "err", text: r.error });
      if (r.ok) router.refresh();
    });

  return (
    <div className="card space-y-5">
      <h2 className="font-semibold">Payment timing and wording</h2>

      <Group title="Timing" hint="Orders already placed keep the deadline they were given (or none).">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={f.paymentDeadline} onChange={(e) => setF((p) => ({ ...p, paymentDeadline: e.target.checked }))} />
          <span>
            Cancel unpaid orders automatically
            <span className="block text-[11px] text-zinc-500">
              {f.paymentDeadline
                ? `An order with no proof uploaded in time is cancelled and its ${rules.terms.many} go back on sale.`
                : `Off: unpaid orders have no deadline and keep their ${rules.terms.many} until staff cancel them (open the order under Orders, Awaiting payment, then Cancel unpaid order).`}
            </span>
          </span>
        </label>
        {f.paymentDeadline && (
          <>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5" checked={f.paymentReminder} onChange={(e) => setF((p) => ({ ...p, paymentReminder: e.target.checked }))} />
              <span>
                Email a reminder before the deadline
                <span className="block text-[11px] text-zinc-500">Needs email sending set up and the reminder job scheduled on the server.</span>
              </span>
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              <NumberField label="Time to pay" suffix="minutes" min={15} max={1440} value={f.paymentWindowMinutes} onChange={(v) => setF((p) => ({ ...p, paymentWindowMinutes: v }))} hint={`${cap(rules.terms.many)} are held this long.`} />
              {f.paymentReminder && <NumberField label="Reminder email" suffix="min before" min={5} max={120} value={f.reminderMinutes} onChange={(v) => setF((p) => ({ ...p, reminderMinutes: v }))} hint="Keep it above the 5-minute cron interval." />}
              <NumberField label="Skip expiry notices after" suffix="hours" min={1} max={48} value={f.expiryNoticeMaxAgeHours} onChange={(v) => setF((p) => ({ ...p, expiryNoticeMaxAgeHours: v }))} hint="Stops a stale backlog going out at once." />
            </div>
          </>
        )}
      </Group>

      <Group title="How each channel is named" hint="Used on the payment page, in emails and on staff screens.">
        <div className="space-y-2">
          {CHANNEL_ORDER.map((k) => {
            const c = f.channels[k];
            return (
              <details key={k} className="group rounded-xl border border-white/10 bg-black/20 p-3 open:bg-black/30">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm">
                  <span className="font-semibold">{c.label}</span>
                  <span className="truncate text-xs text-zinc-500">&ldquo;Open your {c.app} app&rdquo;</span>
                </summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div><label className="label">Full name</label><input className="input h-9" maxLength={40} value={c.label} onChange={(e) => setCh(k, { label: e.target.value })} /></div>
                  <div><label className="label">Short name</label><input className="input h-9" maxLength={30} value={c.app} onChange={(e) => setCh(k, { app: e.target.value })} /></div>
                  <div><label className="label">&ldquo;Pay via&rdquo; on the order form</label><input className="input h-9" maxLength={60} value={c.via} onChange={(e) => setCh(k, { via: e.target.value })} /></div>
                  <div><label className="label">&ldquo;Pay via&rdquo; in page text and emails</label><input className="input h-9" maxLength={80} value={c.payVia} onChange={(e) => setCh(k, { payVia: e.target.value })} /></div>
                  {k !== "cash" && (
                    <>
                      <div><label className="label">Aside after the app name</label><input className="input h-9" maxLength={120} value={c.scanHint ?? ""} placeholder="or any bank app with InstaPay QR" onChange={(e) => setCh(k, { scanHint: opt(e.target.value) })} /></div>
                      <div><label className="label">Note under the QR</label><input className="input h-9" maxLength={240} value={c.hint ?? ""} onChange={(e) => setCh(k, { hint: opt(e.target.value) })} /></div>
                      <div className="sm:col-span-2">
                        <AssetField label="Where to find the reference number" value={c.referenceImage ?? ""} onChange={(v) => setCh(k, { referenceImage: opt(v) })} onClear={() => setCh(k, { referenceImage: undefined })} defaultLabel="None" hint="Screenshot shown under the proof-of-payment form." />
                      </div>
                    </>
                  )}
                </div>
              </details>
            );
          })}
        </div>
      </Group>

      <SaveBar label="Save timing and wording" dirty={dirty} pending={pending} msg={msg} onSave={save} onDiscard={() => { setF(initial); setMsg(null); }} />
    </div>
  );
}
