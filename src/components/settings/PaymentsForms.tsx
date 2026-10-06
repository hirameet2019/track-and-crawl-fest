"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { savePaymentQr, saveRulesSection, type PaymentQrInput, type PaymentQrValues } from "@/app/actions/setup";
import { AssetField } from "@/components/AssetField";
import { ONLINE_CHANNELS } from "@/config/event";
import { Group, NumberField, SaveBar, changed, type SaveMsg } from "@/components/settings/SaveBar";
import type { Rules } from "@/lib/rules-types";
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
          Buyers can pay with any channel that has a QR. Instructions name the first one{primary ? <>, now <b className="text-zinc-300">{channels[primary].label}</b></> : null}.
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

const CHANNEL_ORDER: PaymentMethod[] = ["gotyme", "gcash", "maya", "cash"];

/** How long buyers have to pay, the reminder, and the wording used for each channel. */
export function PaymentRulesForm({ rules }: { rules: Rules }) {
  const router = useRouter();
  const pick = (r: Rules) => ({
    paymentWindowMinutes: r.paymentWindowMinutes,
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

      <Group title="Timing" hint="Orders already placed keep the deadline they were given.">
        <div className="grid gap-3 sm:grid-cols-3">
          <NumberField label="Time to pay" suffix="minutes" min={15} max={1440} value={f.paymentWindowMinutes} onChange={(v) => setF((p) => ({ ...p, paymentWindowMinutes: v }))} hint="Wristbands are held this long." />
          <NumberField label="Reminder email" suffix="min before" min={5} max={120} value={f.reminderMinutes} onChange={(v) => setF((p) => ({ ...p, reminderMinutes: v }))} hint="Keep it above the 5-minute cron interval." />
          <NumberField label="Skip expiry notices after" suffix="hours" min={1} max={48} value={f.expiryNoticeMaxAgeHours} onChange={(v) => setF((p) => ({ ...p, expiryNoticeMaxAgeHours: v }))} hint="Stops a stale backlog going out at once." />
        </div>
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
