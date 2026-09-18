"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveEmailSettingsAction, sendTestEmailAction } from "@/app/actions/settings";
import { PasswordInput } from "@/components/PasswordInput";

export interface EmailSettingsView {
  provider: "smtp" | "resend" | "dry-run";
  source: "database" | "environment" | "none";
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_secure: boolean;
  has_smtp_pass: boolean;
  has_resend_key: boolean;
  from: string;
}

const PRESETS: { label: string; host: string; port: number; hint: string }[] = [
  { label: "Microsoft 365 / Outlook", host: "smtp.office365.com", port: 587, hint: "SMTP AUTH must be enabled on the mailbox; use an app password if MFA is on." },
  { label: "Gmail", host: "smtp.gmail.com", port: 587, hint: "Requires a Google app password (2-Step Verification on). Limit 500 emails/day." },
];

export function EmailSettingsForm({ current, defaultEmail }: { current: EmailSettingsView; defaultEmail: string }) {
  const router = useRouter();
  const [host, setHost] = useState(current.smtp_host);
  const [port, setPort] = useState(String(current.smtp_port || 587));
  const [secure, setSecure] = useState(current.smtp_secure);
  // Implicit TLS on a STARTTLS port (587/25) makes the client speak TLS to a
  // plain-text greeting: "SSL routines ... wrong version number". Flag it inline.
  const tlsMismatch = secure && port.trim() !== "465";
  const [testTo, setTestTo] = useState(defaultEmail);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pending, start] = useTransition();

  function onSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const r = await saveEmailSettingsAction(fd);
      setMsg(r.ok ? { kind: "ok", text: "Saved. New emails use these settings immediately." } : { kind: "err", text: r.error });
      if (r.ok) router.refresh();
    });
  }

  function onTest() {
    setMsg(null);
    start(async () => {
      const r = await sendTestEmailAction(testTo);
      setMsg(r.ok ? { kind: "ok", text: r.warning ?? "Test email sent." } : { kind: "err", text: r.error });
    });
  }

  const status =
    current.provider === "smtp" ? `SMTP via ${current.smtp_host}:${current.smtp_port} as ${current.smtp_user || "(no login)"}${current.smtp_user && !current.has_smtp_pass ? " — password not set, sending will fail" : ""}` :
    current.provider === "resend" ? "Resend API" : "Not configured. Emails are logged on the server and not sent.";

  return (
    <div className="space-y-5">
      <div className={`card ${current.provider === "dry-run" ? "border-amber-300 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Current status</div>
        <div className="mt-1 font-medium">{status}</div>
        {current.provider !== "dry-run" && (
          <div className="text-xs text-zinc-600">
            From: {current.from || "(not set)"} &middot; source: {current.source === "database" ? "saved here" : "server environment file"}
          </div>
        )}
      </div>

      <form onSubmit={onSave} className="card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">SMTP server</h2>
          <div className="flex gap-2">
            {PRESETS.map((p) => (
              <button type="button" key={p.host} className="btn-secondary px-3 py-1 text-xs" onClick={() => { setHost(p.host); setPort(String(p.port)); }} title={p.hint}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
          <div><label className="label">Host</label><input name="smtp_host" className="input" value={host} onChange={(e) => setHost(e.target.value)} placeholder="smtp.office365.com" /></div>
          <div><label className="label">Port</label><input name="smtp_port" className="input" inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value)} /></div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label">Username (mailbox)</label><input name="smtp_user" className="input" defaultValue={current.smtp_user} placeholder="tickets@yourdomain.com" autoComplete="off" /></div>
          <div>
            <label className="label">Password / app password</label>
            <PasswordInput name="smtp_pass" placeholder={current.has_smtp_pass ? "•••••••• (saved, leave blank to keep)" : ""} autoComplete="new-password" />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="smtp_secure" checked={secure} onChange={(e) => setSecure(e.target.checked)} /> Use implicit TLS (port 465 only). Leave off for 587.
        </label>
        {tlsMismatch && (
          <p className="enter rounded-lg border border-amber-400/40 bg-amber-400/10 p-2 text-xs text-amber-200">
            Implicit TLS only works on port 465. Port {port.trim() || "587"} uses STARTTLS, so leave this unchecked or sending fails with
            <code className="mx-1 rounded bg-black/40 px-1">wrong version number</code>.
            <button type="button" className="ml-1 font-semibold underline" onClick={() => setSecure(false)}>Uncheck it</button>
          </p>
        )}
        <div>
          <label className="label">From (shown to buyers)</label>
          <input name="from" className="input" defaultValue={current.from} placeholder='Drift Event Tickets <tickets@yourdomain.com>' />
          <p className="mt-1 text-xs text-zinc-500">Must be the mailbox above or an address it is allowed to send as.</p>
        </div>
        <details className="text-sm">
          <summary className="cursor-pointer text-zinc-600">Alternative: Resend API key (used only when no SMTP host is set)</summary>
          <div className="mt-2">
            <PasswordInput name="resend_api_key" placeholder={current.has_resend_key ? "•••••••• (saved, leave blank to keep)" : "re_..."} autoComplete="off" />
          </div>
        </details>
        <p className="text-xs text-zinc-500">{PRESETS.find((p) => p.host === host)?.hint}</p>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" disabled={pending}>{pending ? "Saving..." : "Save email settings"}</button>
          <span className="text-xs text-zinc-500 self-center">Clearing the host and the API key reverts to the server environment file.</span>
        </div>
      </form>

      <div className="card space-y-3">
        <h2 className="font-semibold">Send a test email</h2>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input className="input" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com" />
          <button type="button" className="btn-secondary whitespace-nowrap" disabled={pending || current.provider === "dry-run"} onClick={onTest}>
            {pending ? "Sending..." : "Send test"}
          </button>
        </div>
        <p className="text-xs text-zinc-500">Uses the saved settings. Save first if you changed anything above.</p>
      </div>

      {msg && (
        <p className={`rounded-lg border p-3 text-sm ${msg.kind === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-700"}`}>{msg.text}</p>
      )}
    </div>
  );
}
