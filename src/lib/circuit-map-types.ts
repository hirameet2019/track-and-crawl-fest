/**
 * The circuit map as stored in site settings (Settings > Look > Circuit). All
 * coordinates are pixels of the traced overhead photo, so the outline, the curbs
 * and everything placed on top share one space. Kept free of server imports: the
 * editor in the browser and the page renderer both use it.
 */

export type MapBlockKind = "building" | "parking" | "zone";
export type MapLabelSize = "s" | "m" | "l";

/** A rectangle on the map, centred on x/y and turned by angle (degrees clockwise). */
export interface MapBlock {
  id: string;
  kind: MapBlockKind;
  x: number;
  y: number;
  w: number;
  h: number;
  angle: number;
}

export interface MapLabel {
  id: string;
  x: number;
  y: number;
  text: string;
  angle: number;
  size: MapLabelSize;
  /** Soft labels sit quietly on the asphalt; bold ones carry a dark halo. */
  soft: boolean;
  /** Optional dashed line from the label to a point on the map. */
  leader: { x: number; y: number } | null;
}

/** A double chevron pointing along angle: the direction of travel. */
export interface MapArrow {
  id: string;
  x: number;
  y: number;
  angle: number;
}

export interface StartFinish {
  x: number;
  y: number;
  /** Direction of travel across the line, degrees clockwise from east. */
  angle: number;
  /** Half the track width at the line. */
  halfWidth: number;
  /** Grid boxes drawn behind the line, staggered left and right. 0 hides them. */
  gridBoxes: number;
}

/** How the outline was traced, kept so it can be traced again with new settings. */
export interface TraceSource {
  /** The overhead photo: a /public path or an uploaded URL. */
  image: string;
  /** The track surface colour, picked from the photo. */
  color: [number, number, number];
  /** How far a pixel's colour may differ from it and still count as track (per channel). */
  tolerance: number;
  /** Closes gaps this many pixels wide (curb paint, cars, shadows on the track). */
  closeGaps: number;
  /** Removes spurs and specks thinner than this. */
  removeThin: number;
  /** Edge smoothing, 1 (tight) to 6 (soft). */
  smooth: number;
  /** Look for red and white curb paint along the edges. */
  curbs: boolean;
}

export interface CircuitMapData {
  /** Size of the traced photo: the coordinate space. */
  width: number;
  height: number;
  /** The asphalt's bounding box [x, y, w, h], for framing the map. */
  bounds: [number, number, number, number];
  /** Every edge of the asphalt in one path, filled with fill-rule="evenodd". */
  asphalt: string;
  /** Curb runs as open paths along the asphalt edge. */
  curbs: string[];
  startFinish: StartFinish | null;
  arrows: MapArrow[];
  blocks: MapBlock[];
  labels: MapLabel[];
  source: TraceSource | null;
}

/** What a trace produces; the editor merges it into the map, keeping the placed items. */
export type TraceResult = Pick<CircuitMapData, "width" | "height" | "bounds" | "asphalt" | "curbs">;

export const MAP_LIMITS = { labels: 30, blocks: 30, arrows: 12, curbs: 200, gridBoxes: 20, text: 40 } as const;

export const LABEL_PX: Record<MapLabelSize, number> = { s: 15, m: 21, l: 26 };

/** A short random id for a new map item. */
export const mapId = () => Math.random().toString(36).slice(2, 9);

/** Rough box a label occupies, for framing (condensed italic caps with tracking, about 0.62 em per character). */
function labelBox(l: MapLabel): [number, number, number, number] {
  const px = LABEL_PX[l.size];
  const w = l.text.length * px * 0.62 + 10;
  const r = Math.max(w, px) / 2 + 4;
  return [l.x - r, l.y - r, r * 2, r * 2];
}

/** The viewBox that frames the asphalt and everything placed around it, with a margin. */
export function mapViewBox(m: CircuitMapData, margin = 18): string {
  const [bx, by, bw, bh] = m.bounds;
  let x1 = bx, y1 = by, x2 = bx + bw, y2 = by + bh;
  const grow = (bx: number, by: number, bw: number, bh: number) => {
    x1 = Math.min(x1, bx); y1 = Math.min(y1, by); x2 = Math.max(x2, bx + bw); y2 = Math.max(y2, by + bh);
  };
  for (const b of m.blocks) {
    const r = Math.hypot(b.w, b.h) / 2;
    const a = (b.angle * Math.PI) / 180;
    // Extent of a turned rectangle, not its circumscribed circle, so long thin strips frame tightly.
    const ex = Math.abs((b.w / 2) * Math.cos(a)) + Math.abs((b.h / 2) * Math.sin(a));
    const ey = Math.abs((b.w / 2) * Math.sin(a)) + Math.abs((b.h / 2) * Math.cos(a));
    grow(b.x - Math.min(ex, r), b.y - Math.min(ey, r), Math.min(ex, r) * 2, Math.min(ey, r) * 2);
  }
  for (const l of m.labels) {
    grow(...labelBox(l));
    if (l.leader) grow(l.leader.x, l.leader.y, 0, 0);
  }
  for (const a of m.arrows) grow(a.x - 12, a.y - 12, 24, 24);
  x1 = Math.max(0, x1 - margin); y1 = Math.max(0, y1 - margin);
  x2 = Math.min(m.width, x2 + margin); y2 = Math.min(m.height, y2 + margin);
  return [x1, y1, x2 - x1, y2 - y1].map((v) => Math.round(v)).join(" ");
}

/** A point `s` along the start/finish direction from the line, `off` to its right. */
export function alongLine(sf: StartFinish, s: number, off = 0): [number, number] {
  const a = (sf.angle * Math.PI) / 180;
  const ux = Math.cos(a), uy = Math.sin(a);
  return [sf.x + ux * s - uy * off, sf.y + uy * s + ux * off];
}
