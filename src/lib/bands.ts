import type { CSSProperties } from "react";

/** Wristband colour names (as written by the organizer) → swatch colours. */
const BASE: Record<string, string> = {
  blue: "#2563eb",
  yellow: "#facc15",
  orange: "#f97316",
  red: "#dc2626",
  pink: "#ec4899",
  green: "#22c55e",
  gold: "#d4a017",
  black: "#111111",
  white: "#eeeeee",
  purple: "#8b5cf6",
};

export function bandKey(color: string | null | undefined): string | null {
  const k = (color ?? "").toLowerCase();
  return Object.keys(BASE).find((b) => k.includes(b)) ?? null;
}

/** Inline style for a small swatch; "stripes" bands render as diagonal stripes. */
export function bandSwatchStyle(color: string | null | undefined): CSSProperties {
  const key = bandKey(color);
  const hex = key ? BASE[key] : "#777777";
  if (/stripe/i.test(color ?? "")) {
    return { backgroundImage: `repeating-linear-gradient(135deg, ${hex} 0 6px, #f4f4f5 6px 10px)` };
  }
  return { backgroundColor: hex };
}
