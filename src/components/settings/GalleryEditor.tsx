"use client";

import { useRef, useState } from "react";
import { createAssetUpload } from "@/app/actions/setup";
import type { GalleryPhoto } from "@/config/site";
import { shrinkImage } from "@/lib/image";
import { MAX_GALLERY_PHOTOS, type SiteSettings } from "@/lib/site-settings";
import { createClient } from "@/lib/supabase/client";

type Gallery = SiteSettings["gallery"];

const FOCUS = [
  { value: "", label: "Center" },
  { value: "center top", label: "Top" },
  { value: "center 35%", label: "Upper" },
  { value: "center 65%", label: "Lower" },
  { value: "center bottom", label: "Bottom" },
  { value: "left center", label: "Left" },
  { value: "right center", label: "Right" },
];
const ACCEPT = "image/png,image/jpeg,image/webp";

/**
 * Settings > Look > Past event photos. Upload several at once (button or drop
 * files on the grid), drag a photo by its picture to reorder, and give each a
 * description and a focus point. The first photo is the large tile on the page.
 *
 * Reordering uses pointer events rather than HTML drag-and-drop so it works the
 * same with a mouse and a finger: the list reorders live as the pointer passes
 * over another tile. Arrow buttons do the same for keyboards.
 */
export function GalleryEditor({ value, onChange }: { value: Gallery; onChange: (v: Gallery) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [dropping, setDropping] = useState(false);
  const photos = value.photos;
  const room = MAX_GALLERY_PHOTOS - photos.length;

  const setPhotos = (next: GalleryPhoto[]) => onChange({ ...value, photos: next });
  const setPhoto = (i: number, patch: Partial<GalleryPhoto>) => setPhotos(photos.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= photos.length || from === to) return;
    const next = [...photos];
    const [p] = next.splice(from, 1);
    next.splice(to, 0, p);
    setPhotos(next);
  };

  async function upload(files: File[]) {
    setErr(null);
    const picked = files.filter((f) => f.type.startsWith("image/")).slice(0, room);
    if (!picked.length) {
      setErr(room <= 0 ? `The gallery is full (${MAX_GALLERY_PHOTOS} photos).` : "Choose PNG, JPG or WebP images.");
      return;
    }
    const added: GalleryPhoto[] = [];
    try {
      for (const [n, original] of picked.entries()) {
        setBusy(`Uploading ${n + 1} of ${picked.length}...`);
        const file = await shrinkImage(original);
        const r = await createAssetUpload(file.type, file.size);
        if (!r.ok) throw new Error(r.error);
        const { error } = await createClient().storage.from("event-assets").uploadToSignedUrl(r.path, r.token, file, { contentType: file.type });
        if (error) throw new Error(error.message);
        added.push({ src: r.publicUrl, alt: "Photo from a past event" });
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      // Keep whatever made it up before a failure.
      if (added.length) setPhotos([...photos, ...added]);
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  }

  function startDrag(e: React.PointerEvent<HTMLElement>, i: number) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(i);
  }
  function dragMove(e: React.PointerEvent<HTMLElement>) {
    if (dragging === null) return;
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-gallery-index]");
    const to = over ? Number(over.dataset.galleryIndex) : NaN;
    if (Number.isInteger(to) && to !== dragging) {
      move(dragging, to);
      setDragging(to);
    }
  }
  const endDrag = () => setDragging(null);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,20rem)_1fr] sm:items-end">
        <div>
          <label className="label" htmlFor="gallery-title">Heading</label>
          <input id="gallery-title" className="input h-9" value={value.title} onChange={(e) => onChange({ ...value, title: e.target.value })} maxLength={60} placeholder="From past events" />
        </div>
        <p className="text-xs text-zinc-500">Blank hides the heading. No photos hides the whole gallery.</p>
      </div>

      <div
        className={`rounded-xl border border-dashed p-3 transition-colors ${dropping ? "border-cyan-400 bg-cyan-400/5" : "border-white/15"}`}
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDropping(true); } }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false); }}
        onDrop={(e) => { e.preventDefault(); setDropping(false); if (!busy) void upload([...e.dataTransfer.files]); }}
      >
        {photos.length > 0 ? (
          <ol className="grid grid-cols-2 gap-3 md:grid-cols-3" aria-label="Past event photos, in page order">
            {photos.map((p, i) => (
              <li
                key={p.src}
                data-gallery-index={i}
                className={`rounded-lg border bg-black/25 p-2 transition-shadow ${dragging === i ? "border-cyan-400 shadow-[0_0_0_2px_var(--color-cyan-400)]" : "border-white/10"}`}
              >
                <div
                  role="button"
                  tabIndex={-1}
                  aria-label={`Drag to reorder photo ${i + 1}`}
                  title="Drag to reorder"
                  className={`relative aspect-[4/3] touch-none select-none overflow-hidden rounded-md bg-black/40 ${dragging === i ? "cursor-grabbing opacity-70" : "cursor-grab"}`}
                  onPointerDown={(e) => startDrag(e, i)}
                  onPointerMove={dragMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.src} alt="" draggable={false} className="pointer-events-none h-full w-full object-cover" style={p.position ? { objectPosition: p.position } : undefined} />
                  <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                    {i + 1}{i === 0 ? " · Large tile" : ""}
                  </span>
                  <svg viewBox="0 0 24 24" className="absolute right-1.5 top-1.5 h-6 w-6 rounded bg-black/70 p-1 text-white" fill="currentColor" aria-hidden>
                    <circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" />
                  </svg>
                </div>
                <label className="sr-only" htmlFor={`gallery-alt-${i}`}>Description of photo {i + 1}</label>
                <input id={`gallery-alt-${i}`} className="input mt-2 h-8 text-xs" value={p.alt} onChange={(e) => setPhoto(i, { alt: e.target.value })} maxLength={120} placeholder="What the photo shows" />
                <div className="mt-2 flex items-center gap-1">
                  <select className="input h-8 min-w-0 flex-1 px-2 text-xs" value={p.position ?? ""} onChange={(e) => setPhoto(i, { position: e.target.value || undefined })} aria-label={`Focus point of photo ${i + 1}`} title="Which part stays in frame when the tile crops the photo">
                    {FOCUS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                    {p.position && !FOCUS.some((f) => f.value === p.position) && <option value={p.position}>Custom ({p.position})</option>}
                  </select>
                  <button type="button" className="btn-secondary h-8 px-2 text-xs" disabled={i === 0} onClick={() => move(i, i - 1)} aria-label={`Move photo ${i + 1} earlier`}>&larr;</button>
                  <button type="button" className="btn-secondary h-8 px-2 text-xs" disabled={i === photos.length - 1} onClick={() => move(i, i + 1)} aria-label={`Move photo ${i + 1} later`}>&rarr;</button>
                  <button type="button" className="btn-secondary h-8 px-2 text-xs" onClick={() => setPhotos(photos.filter((_, j) => j !== i))} aria-label={`Remove photo ${i + 1}`} title="Remove">&times;</button>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="py-6 text-center text-sm text-zinc-500">No photos: the gallery is hidden on the page.</p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" className="btn-secondary text-sm" disabled={!!busy || room <= 0} onClick={() => input.current?.click()}>
            {busy ?? "+ Add photos"}
          </button>
          <span className="text-xs text-zinc-500">
            {photos.length} of {MAX_GALLERY_PHOTOS} · or drop image files here. Large photos are shrunk to 1600 px before upload.
          </span>
        </div>
      </div>
      <input ref={input} type="file" accept={ACCEPT} multiple className="hidden" onChange={(e) => void upload([...(e.target.files ?? [])])} />
      {err && <p className="text-xs text-red-400">{err}</p>}
      <p className="text-xs text-zinc-500">Drag a photo by its picture to change the order. Changes show on the page after Save look.</p>
    </div>
  );
}
