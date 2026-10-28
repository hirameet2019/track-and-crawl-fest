import sharp from "sharp";
import type { TraceResult, TraceSource } from "./circuit-map-types";

/**
 * Traces a circuit from an overhead photo: finds the track surface by colour,
 * cleans it up, and turns its edges into smooth SVG paths. Curbs are the runs of
 * red or white paint found just outside those edges. Coordinates are pixels of
 * the photo after it is scaled to fit MAX_SIDE.
 *
 * Server only (sharp). Pure computation otherwise, so it can be run on its own.
 */

const MAX_SIDE = 1200;

type Mask = Uint8Array;
type Pt = [number, number];
type TraceParams = Omit<TraceSource, "image">;

/** Grows (or shrinks) the 1s by r pixels: alternating cross and square steps approximate a disc. */
function morph(a: Mask, W: number, H: number, r: number, grow: boolean): Mask {
  let cur = a;
  for (let step = 0; step < r; step++) {
    const square = step % 2 === 1;
    const out = new Uint8Array(cur.length);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let v = grow ? 0 : 1;
        for (let dy = -1; dy <= 1 && v === (grow ? 0 : 1); dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!square && dx !== 0 && dy !== 0) continue;
            const xx = x + dx, yy = y + dy;
            const p = xx < 0 || yy < 0 || xx >= W || yy >= H ? 0 : cur[yy * W + xx];
            if (grow ? p : !p) { v = grow ? 1 : 0; break; }
          }
        }
        out[y * W + x] = v;
      }
    }
    cur = out;
  }
  return cur;
}

/** Labels the 4-connected regions of value `val`; returns each pixel's region and the region sizes. */
function regions(a: Mask, W: number, H: number, val: 0 | 1) {
  const lab = new Int32Array(a.length).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let s = 0; s < a.length; s++) {
    if (a[s] !== val || lab[s] !== -1) continue;
    const id = sizes.length;
    let size = 0;
    lab[s] = id;
    stack.push(s);
    while (stack.length) {
      const p = stack.pop()!;
      size++;
      const x = p % W, y = (p / W) | 0;
      if (x > 0 && a[p - 1] === val && lab[p - 1] === -1) { lab[p - 1] = id; stack.push(p - 1); }
      if (x < W - 1 && a[p + 1] === val && lab[p + 1] === -1) { lab[p + 1] = id; stack.push(p + 1); }
      if (y > 0 && a[p - W] === val && lab[p - W] === -1) { lab[p - W] = id; stack.push(p - W); }
      if (y < H - 1 && a[p + W] === val && lab[p + W] === -1) { lab[p + W] = id; stack.push(p + W); }
    }
    sizes.push(size);
  }
  return { lab, sizes };
}

function keepLargest(a: Mask, W: number, H: number): Mask {
  const { lab, sizes } = regions(a, W, H, 1);
  if (!sizes.length) return a;
  const big = sizes.indexOf(Math.max(...sizes));
  return Uint8Array.from(lab, (l) => (l === big ? 1 : 0));
}

/** Douglas-Peucker on an open polyline. */
function simplify(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  let dmax = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + b[0] * a[1] - b[1] * a[0]) / len;
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax <= eps) return [a, b];
  return simplify(pts.slice(0, idx + 1), eps).slice(0, -1).concat(simplify(pts.slice(idx), eps));
}

/** Douglas-Peucker on a closed loop: split at the point farthest from the start, since a loop's ends coincide. */
function simplifyLoop(loop: Pt[], eps: number): Pt[] {
  const a = loop[0];
  let far = 0, dm = -1;
  loop.forEach((p, i) => { const d = Math.hypot(p[0] - a[0], p[1] - a[1]); if (d > dm) { dm = d; far = i; } });
  return simplify(loop.slice(0, far + 1), eps).slice(0, -1).concat(simplify(loop.slice(far).concat([a]), eps).slice(0, -1));
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Catmull-Rom through the points as cubic Béziers; closed loops end with Z. */
function smoothPath(p: Pt[], closed: boolean): string {
  const n = p.length;
  const get = (i: number) => (closed ? p[(i + n) % n] : p[Math.max(0, Math.min(n - 1, i))]);
  let d = `M${r1(p[0][0])} ${r1(p[0][1])}`;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    d += `C${r1(p1[0] + (p2[0] - p0[0]) / 6)} ${r1(p1[1] + (p2[1] - p0[1]) / 6)} ${r1(p2[0] - (p3[0] - p1[0]) / 6)} ${r1(p2[1] - (p3[1] - p1[1]) / 6)} ${r1(p2[0])} ${r1(p2[1])}`;
  }
  return closed ? d + "Z" : d;
}

/** Marching squares at half height over a blurred mask, chained into closed loops. */
async function contours(m: Mask, W: number, H: number, sigma: number): Promise<Pt[][]> {
  const P = 2, PW = W + 2 * P, PH = H + 2 * P;
  const v = await sharp(Buffer.from(m.map((x) => (x ? 255 : 0))), { raw: { width: W, height: H, channels: 1 } })
    .extend({ top: P, bottom: P, left: P, right: P, background: { r: 0, g: 0, b: 0 } })
    .blur(sigma)
    .extractChannel(0)
    .raw()
    .toBuffer();
  const T = 128;
  const at = (x: number, y: number) => v[y * PW + x];
  const cross = (x1: number, y1: number, x2: number, y2: number): Pt => {
    const t = (T - at(x1, y1)) / (at(x2, y2) - at(x1, y1));
    return [x1 + (x2 - x1) * t - P, y1 + (y2 - y1) * t - P];
  };
  const key = (p: Pt) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
  const segs: [Pt, Pt][] = [];
  for (let y = 0; y < PH - 1; y++) {
    for (let x = 0; x < PW - 1; x++) {
      const c = (at(x, y) >= T ? 8 : 0) | (at(x + 1, y) >= T ? 4 : 0) | (at(x + 1, y + 1) >= T ? 2 : 0) | (at(x, y + 1) >= T ? 1 : 0);
      if (c === 0 || c === 15) continue;
      const top = () => cross(x, y, x + 1, y), right = () => cross(x + 1, y, x + 1, y + 1);
      const bottom = () => cross(x, y + 1, x + 1, y + 1), left = () => cross(x, y, x, y + 1);
      const table: Record<number, [() => Pt, () => Pt][]> = {
        1: [[left, bottom]], 2: [[bottom, right]], 3: [[left, right]], 4: [[top, right]], 5: [[left, top], [bottom, right]],
        6: [[top, bottom]], 7: [[left, top]], 8: [[left, top]], 9: [[top, bottom]], 10: [[left, bottom], [top, right]],
        11: [[top, right]], 12: [[left, right]], 13: [[bottom, right]], 14: [[left, bottom]],
      };
      for (const [a, b] of table[c]) segs.push([a(), b()]);
    }
  }
  const byEnd = new Map<string, number[]>();
  segs.forEach((s, i) => s.forEach((p) => { const k = key(p); byEnd.set(k, [...(byEnd.get(k) ?? []), i]); }));
  const used = new Uint8Array(segs.length);
  const loops: Pt[][] = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const loop: Pt[] = [segs[i][0], segs[i][1]];
    for (;;) {
      const k = key(loop[loop.length - 1]);
      const next = (byEnd.get(k) ?? []).find((j) => !used[j]);
      if (next === undefined) break;
      used[next] = 1;
      loop.push(key(segs[next][0]) === k ? segs[next][1] : segs[next][0]);
    }
    loops.push(loop.slice(0, -1));
  }
  return loops;
}

const area = (l: Pt[]) => l.reduce((s, [x1, y1], i) => { const [x2, y2] = l[(i + 1) % l.length]; return s + x1 * y2 - x2 * y1; }, 0) / 2;

/** Points every `step` px around a closed loop. */
function resample(pts: Pt[], step: number): Pt[] {
  const out: Pt[] = [];
  let carry = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let t = carry;
    while (t < L) { out.push([a[0] + ((b[0] - a[0]) * t) / L, a[1] + ((b[1] - a[1]) * t) / L]); t += step; }
    carry = t - L;
  }
  return out;
}

/** Runs of curb paint (white, or saturated red) within a few pixels of the asphalt edge. */
function findCurbs(loops: Pt[][], rgb: Buffer, W: number, H: number): string[] {
  const paint = (fx: number, fy: number) => {
    const x = Math.round(fx), y = Math.round(fy);
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    const i = (y * W + x) * 3, r = rgb[i], g = rgb[i + 1], b = rgb[i + 2];
    const mean = (r + g + b) / 3;
    return (mean >= 175 && Math.max(r, g, b) - Math.min(r, g, b) <= 45) || (r >= 150 && g <= 95 && b <= 95);
  };
  const curbs: string[] = [];
  for (const loop of loops) {
    const p = resample(loop, 2);
    const n = p.length;
    if (n < 16) continue;
    const hit = p.map((pt, i) => {
      const a = p[(i - 2 + n) % n], b = p[(i + 2) % n];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L;
      let hits = 0;
      // Either side of the edge: the loop's winding (outer edge or hole) is not known here.
      for (const s of [-1, 1]) for (let d = -1; d <= 5; d++) if (paint(pt[0] + s * nx * d, pt[1] + s * ny * d)) hits++;
      return hits >= 2;
    });
    // Bridge gaps of up to 4 samples, then keep runs of at least 8 (16 px).
    const near = (i: number, dir: -1 | 1) => [1, 2, 3, 4].some((k) => hit[(i + dir * k + n) % n]);
    const on = hit.map((h, i) => h || (near(i, -1) && near(i, 1)));
    const start = Math.max(0, on.findIndex((v) => !v));
    let run: Pt[] = [];
    for (let k = 1; k <= n; k++) {
      const i = (start + k) % n;
      if (on[i]) run.push(p[i]);
      else { if (run.length >= 8) curbs.push(smoothPath(run.filter((_, j) => j % 2 === 0 || j === run.length - 1), false)); run = []; }
    }
    if (run.length >= 8) curbs.push(smoothPath(run.filter((_, j) => j % 2 === 0 || j === run.length - 1), false));
  }
  return curbs;
}

/** Traces the track in an image. Throws with a message an admin can act on. */
export async function traceCircuit(image: Buffer, params: TraceParams): Promise<TraceResult> {
  const { data: rgb, info } = await sharp(image)
    .rotate()
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, N = W * H;
  // Track surface varies a lot in brightness (shadows, worn and fresh patches) but
  // hardly in colour cast, which is what tells grey asphalt from dull dirt of the
  // same brightness. So brightness gets the full tolerance and the cast (the R-G
  // and G-B differences) a tighter share of it.
  const [cr, cg, cb] = params.color;
  const lum0 = (cr + cg + cb) / 3, rg0 = cr - cg, gb0 = cg - cb;
  const tol = params.tolerance, castTol = Math.max(6, tol * 0.45);

  let m: Mask = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
    const lumOk = Math.abs((r + g + b) / 3 - lum0) <= tol;
    const castOk = Math.abs(r - g - rg0) <= castTol && Math.abs(g - b - gb0) <= castTol;
    m[i] = lumOk && castOk ? 1 : 0;
  }
  m = morph(morph(m, W, H, 1, false), W, H, 1, true); // drop single-pixel speckle
  if (params.closeGaps > 0) m = morph(morph(m, W, H, params.closeGaps, true), W, H, params.closeGaps, false);
  m = keepLargest(m, W, H);
  // Fill small holes: paint, cars and marks on the track. Real infields are far larger.
  const holes = regions(m, W, H, 0);
  const maxHole = N * 0.0016;
  m = Uint8Array.from(m, (v, i) => (v || holes.sizes[holes.lab[i]] < maxHole ? 1 : 0));
  if (params.removeThin > 0) m = keepLargest(morph(morph(m, W, H, params.removeThin, false), W, H, params.removeThin, true), W, H);

  const count = m.reduce((s, v) => s + v, 0);
  if (count < N * 0.01) throw new Error("Hardly any track found. Click the track surface in the photo to pick its colour, or raise the tolerance.");
  if (count > N * 0.7) throw new Error("Most of the photo matched the track colour. Lower the tolerance or pick the colour again.");

  const sigma = 0.6 + params.smooth * 0.7;
  const eps = 0.5 + params.smooth * 0.25;
  const loops = (await contours(m, W, H, sigma)).filter((l) => l.length > 8 && Math.abs(area(l)) > 60).map((l) => simplifyLoop(l, eps));
  if (!loops.length) throw new Error("Could not find the track's edges. Try less smoothing.");

  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const l of loops) for (const [x, y] of l) { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); }

  return {
    width: W,
    height: H,
    bounds: [Math.floor(x1), Math.floor(y1), Math.ceil(x2 - x1), Math.ceil(y2 - y1)],
    asphalt: loops.map((l) => smoothPath(l, true)).join(""),
    curbs: params.curbs ? findCurbs(loops, rgb, W, H) : [],
  };
}
