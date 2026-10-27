import { bandSwatchStyle } from "@/lib/bands";

/** Small colour chip + label for a ticket colour, e.g. "Blue stripes band". */
export function BandSwatch({ color, size = 14, label = true, className = "" }: { color: string | null | undefined; size?: number; label?: boolean; className?: string }) {
  if (!color) return null;
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span aria-hidden className="inline-block shrink-0 rounded-sm border border-black/30 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.35)]" style={{ width: size, height: size, ...bandSwatchStyle(color) }} />
      {label && <span>{color} band</span>}
    </span>
  );
}
