"use client";

import { useState, useTransition } from "react";
import { submitPaymentProof } from "@/app/actions/orders";
import { useRules } from "@/components/RulesProvider";
import { RichText } from "@/components/RichText";
import { shrinkImage } from "@/lib/image";

/** A channel the buyer can say they paid with (built-in or added in Settings). */
export interface ProofOption {
  id: string;
  label: string;
  app: string;
  referenceImage?: string;
}

export function ProofForm({ orderId, options, vars }: { orderId: string; options: ProofOption[]; vars: Record<string, string | number> }) {
  const { payPage: t } = useRules();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [picked, setPicked] = useState(options.length === 1 ? options[0].id : "");
  const single = options.length === 1;
  // The help screenshot follows the chosen channel, else the first one.
  const help = (options.find((o) => o.id === picked) ?? options[0])?.referenceImage;
  const rich = (text: string) => <RichText text={text} vars={vars} />;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const raw = fd.get("screenshot");
      if (raw instanceof File && raw.size > 0) {
        const small = await shrinkImage(raw);
        if (small.size > 8 * 1024 * 1024) {
          setError("Screenshot is too large even after compression. Please crop it and try again.");
          return;
        }
        fd.set("screenshot", small);
      }
      const res = await submitPaymentProof(fd);
      if (res && !res.ok) setError(res.error);
    });
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-4">
      <input type="hidden" name="order_id" value={orderId} />
      <div>
        <label className="label">{t.methodLabel} *</label>
        <div className="flex flex-wrap gap-3">
          {options.map((o) => (
            <label key={o.id} className="flex min-w-[9rem] flex-1 cursor-pointer items-center gap-2 rounded-xl border border-white/15 bg-black/30 p-3 text-sm has-[:checked]:border-cyan-300/70 has-[:checked]:bg-cyan-300/10">
              <input type="radio" name="payment_channel" value={o.id} required checked={picked === o.id} onChange={() => setPicked(o.id)} />
              {o.label}
            </label>
          ))}
        </div>
        {single && t.onlyOneNote && <p className="mt-1 text-xs text-zinc-500"><RichText text={t.onlyOneNote} vars={{ ...vars, app: options[0].label }} /></p>}
      </div>
      <div>
        <label className="label" htmlFor="proof-reference">{t.referenceLabel} *</label>
        <input id="proof-reference" name="payment_reference" className="input" autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder={t.referencePlaceholder || undefined} required />
        {t.referenceHint && <p className="mt-1 text-xs text-zinc-500">{rich(t.referenceHint)}</p>}
        {t.show.referenceHelp && (t.referenceHelpText || t.referenceHelpTextTl || help) && (
          <details className="mt-2 rounded-xl border border-white/10 bg-black/30 p-3 text-xs">
            <summary className="cursor-pointer font-semibold text-zinc-200">{rich(t.referenceHelpTitle || "Where do I find the reference number?")}</summary>
            {help && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={help} alt="Example confirmation screen with the reference number highlighted" className="mx-auto mt-2 w-full max-w-[260px] rounded-lg border border-white/10" />
            )}
            {(t.referenceHelpText || t.referenceHelpTextTl) && (
              <p className="mt-2 text-zinc-600">
                {rich(t.referenceHelpText)}
                {t.referenceHelpTextTl && <><br /><span className="text-zinc-500">{rich(t.referenceHelpTextTl)}</span></>}
              </p>
            )}
          </details>
        )}
      </div>
      <div>
        <label className="label" htmlFor="proof-screenshot">{t.screenshotLabel} *</label>
        <input id="proof-screenshot" name="screenshot" type="file" accept="image/*" className="input" required />
        {t.screenshotHint && <p className="mt-1 text-xs text-zinc-500">{rich(t.screenshotHint)}</p>}
      </div>
      {error && <p className="enter callout callout-danger">{error}</p>}
      <button className="btn-neon w-full" disabled={pending}>
        {pending ? "Uploading..." : rich(t.submitButton)}
      </button>
    </form>
  );
}
