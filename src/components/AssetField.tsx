"use client";

import { useRef, useState } from "react";
import { createAssetUpload } from "@/app/actions/setup";
import { createClient } from "@/lib/supabase/client";

const ACCEPT = {
  image: "image/png,image/jpeg,image/webp",
  /** The PDF can only embed these two. */
  pdf: "image/png,image/jpeg",
  video: "video/mp4,video/webm",
} as const;

/**
 * One image or video setting: a preview, an Upload button, and the path itself
 * (a /public file or the uploaded URL) for anyone who wants to type it. The
 * file goes straight from the browser to Storage on a one-time signed URL.
 */
export function AssetField({
  label,
  value,
  onChange,
  kind = "image",
  hint,
  defaultLabel,
  onClear,
}: {
  label: string;
  value: string;
  onChange: (url: string) => void;
  kind?: keyof typeof ACCEPT;
  hint?: string;
  /** Shown instead of a preview when the value is empty (e.g. "Built-in file"). */
  defaultLabel?: string;
  /** Offers a "Remove" button that empties the field. */
  onClear?: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function upload(file: File) {
    setErr(null);
    setBusy(true);
    try {
      const r = await createAssetUpload(file.type, file.size);
      if (!r.ok) throw new Error(r.error);
      const { error } = await createClient().storage.from("event-assets").uploadToSignedUrl(r.path, r.token, file, { contentType: file.type });
      if (error) throw new Error(error.message);
      onChange(r.publicUrl);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex items-start gap-3">
        <div className="grid h-16 w-24 shrink-0 place-items-center overflow-hidden rounded-lg border border-white/10 bg-black/40">
          {value ? (
            kind === "video" ? (
              <video src={value} className="h-full w-full object-cover" muted loop autoPlay playsInline />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={value} alt="" className="h-full w-full object-contain" />
            )
          ) : (
            <span className="px-1 text-center text-[10px] text-zinc-500">{defaultLabel ?? "None"}</span>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <input className="input h-9 text-xs" value={value} onChange={(e) => onChange(e.target.value)} placeholder={defaultLabel ? `${defaultLabel} (leave blank)` : "/file.jpg or uploaded URL"} spellCheck={false} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary px-3 py-1 text-xs" disabled={busy} onClick={() => input.current?.click()}>
              {busy ? "Uploading..." : "Upload"}
            </button>
            {onClear && value && (
              <button type="button" className="btn-secondary px-3 py-1 text-xs" disabled={busy} onClick={onClear}>Remove</button>
            )}
          </div>
        </div>
      </div>
      <input ref={input} type="file" accept={ACCEPT[kind]} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
      {err && <p className="mt-1 text-xs text-red-400">{err}</p>}
    </div>
  );
}
