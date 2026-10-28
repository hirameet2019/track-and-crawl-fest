"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { traceCircuitAction } from "@/app/actions/setup";
import { AssetField } from "@/components/AssetField";
import { CircuitMap } from "@/components/CircuitMap";
import { CIRCUIT_MAP_DEFAULT } from "@/config/circuit-map";
import { LABEL_PX, MAP_LIMITS, mapId, type CircuitMapData, type MapBlock, type MapBlockKind, type MapLabel, type TraceSource } from "@/lib/circuit-map-types";

type Tool = "select" | "label" | "building" | "parking" | "zone" | "arrow" | "sf" | "curbs";
type Selection = { kind: "label" | "block" | "arrow"; id: string } | { kind: "sf" } | null;
type Drag = { what: "item" | "leader"; dx: number; dy: number } | null;

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: "select", label: "Move", hint: "Click something on the map to select it; drag to move it. Delete removes it, arrow keys nudge it." },
  { id: "label", label: "+ Label", hint: "Click where the label goes." },
  { id: "building", label: "+ Building", hint: "Click where the building goes, then size and turn it in the panel." },
  { id: "parking", label: "+ Parking", hint: "Click where the parking area goes." },
  { id: "zone", label: "+ Zone", hint: "A soft strip or area, such as a pit lane or run-off. Click to place it." },
  { id: "arrow", label: "+ Arrow", hint: "Direction of travel. Click to place it, then turn it in the panel." },
  { id: "sf", label: "Start / finish", hint: "Click the track where the start/finish line is." },
  { id: "curbs", label: "Remove curbs", hint: "Click a curb that is not really there (pit-lane concrete, a white line) to remove it." },
];

const KIND_NAME: Record<MapBlockKind, string> = { building: "Building", parking: "Parking", zone: "Zone" };

/** Settings that traced the built-in map well; a starting point for any satellite photo. */
const newSource = (image: string): TraceSource => ({ image, color: [92, 94, 92], tolerance: 28, closeGaps: 4, removeThin: 5, smooth: 5, curbs: true });

const r1 = (v: number) => Math.round(v * 10) / 10;
const turn = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;
const hex = ([r, g, b]: [number, number, number]) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/**
 * Settings > Look > Circuit map. Two parts:
 *
 * 1. Trace: upload an overhead photo, click the track to pick its colour, tune
 *    the sliders and trace. The server finds the asphalt and the curbs.
 * 2. Edit: place the start/finish line, direction arrows, buildings, parking,
 *    zones and labels on the traced map, with the photo faded underneath.
 *
 * Nothing is saved until Save look, like the rest of the tab.
 */
export function CircuitMapEditor({ value, onChange }: { value: CircuitMapData | null; onChange: (v: CircuitMapData | null) => void }) {
  const [draft, setDraft] = useState<TraceSource>(value?.source ?? newSource(""));
  const [tracing, startTrace] = useTransition();
  const [traceErr, setTraceErr] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [sel, setSel] = useState<Selection>(null);
  const [photo, setPhoto] = useState(0.35);
  const drag = useRef<Drag>(null);
  const wrap = useRef<HTMLDivElement>(null);

  // A reset, discard or "built-in map" replaces the map: follow its trace settings.
  const [seenSource, setSeenSource] = useState(value?.source);
  if (value?.source !== seenSource) {
    setSeenSource(value?.source);
    if (value?.source) setDraft(value.source);
  }

  const m = value;
  const u = m ? Math.max(m.bounds[2], m.bounds[3]) / 880 || 1 : 1;
  const set = (patch: Partial<CircuitMapData>) => m && onChange({ ...m, ...patch });
  const setLabel = (id: string, patch: Partial<MapLabel>) => m && set({ labels: m.labels.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  const setBlock = (id: string, patch: Partial<MapBlock>) => m && set({ blocks: m.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
  const setArrow = (id: string, angle: number) => m && set({ arrows: m.arrows.map((a) => (a.id === id ? { ...a, angle } : a)) });

  function trace() {
    setTraceErr(null);
    if (!draft.image) { setTraceErr("Upload an overhead photo first."); return; }
    const newPhoto = !!m && m.source?.image !== draft.image;
    const placed = !!m && (m.labels.length + m.blocks.length + m.arrows.length > 0 || !!m.startFinish);
    if (newPhoto && placed && !window.confirm("This is a different photo, so the labels, blocks, arrows and start/finish placed on the old one will be cleared. Trace it?")) return;
    startTrace(async () => {
      const r = await traceCircuitAction(draft);
      if (!r.ok) { setTraceErr(r.error); return; }
      const keep = m && !newPhoto ? m : { startFinish: null, arrows: [], blocks: [], labels: [] };
      onChange({ ...keep, ...r.trace, source: draft });
      setSel(null);
    });
  }

  /** Pointer position in map coordinates. */
  function at(e: React.PointerEvent): [number, number] | null {
    const svg = wrap.current?.querySelector("svg");
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return [r1(p.x), r1(p.y)];
  }

  function itemPos(s: Selection): [number, number] | null {
    if (!m || !s) return null;
    if (s.kind === "sf") return m.startFinish ? [m.startFinish.x, m.startFinish.y] : null;
    const list = s.kind === "label" ? m.labels : s.kind === "block" ? m.blocks : m.arrows;
    const it = list.find((i) => i.id === s.id);
    return it ? [it.x, it.y] : null;
  }

  function moveTo(s: Selection, x: number, y: number) {
    if (!m || !s) return;
    if (s.kind === "sf") { if (m.startFinish) set({ startFinish: { ...m.startFinish, x, y } }); return; }
    if (s.kind === "label") setLabel(s.id, { x, y });
    else if (s.kind === "block") setBlock(s.id, { x, y });
    else set({ arrows: m.arrows.map((a) => (a.id === s.id ? { ...a, x, y } : a)) });
  }

  function remove(s: Selection) {
    if (!m || !s) return;
    if (s.kind === "sf") set({ startFinish: null });
    else if (s.kind === "label") set({ labels: m.labels.filter((l) => l.id !== s.id) });
    else if (s.kind === "block") set({ blocks: m.blocks.filter((b) => b.id !== s.id) });
    else set({ arrows: m.arrows.filter((a) => a.id !== s.id) });
    setSel(null);
  }

  function down(e: React.PointerEvent<HTMLDivElement>) {
    if (!m || e.button !== 0) return;
    const p = at(e);
    if (!p) return;
    const [x, y] = p;
    const target = e.target as Element;
    wrap.current?.focus();

    if (tool === "curbs") {
      const hit = target.closest("[data-curb-hit]");
      if (hit) set({ curbs: m.curbs.filter((_, i) => i !== Number(hit.getAttribute("data-curb-hit"))) });
      return;
    }
    if (tool === "label") {
      const id = mapId();
      set({ labels: [...m.labels, { id, x, y, text: "Label", angle: 0, size: "m", soft: false, leader: null }] });
      setSel({ kind: "label", id }); setTool("select");
      return;
    }
    if (tool === "building" || tool === "parking" || tool === "zone") {
      const id = mapId();
      const size = { building: [60, 40], parking: [120, 40], zone: [200, 14] }[tool];
      set({ blocks: [...m.blocks, { id, kind: tool, x, y, w: r1(size[0] * u), h: r1(size[1] * u), angle: 0 }] });
      setSel({ kind: "block", id }); setTool("select");
      return;
    }
    if (tool === "arrow") {
      const id = mapId();
      set({ arrows: [...m.arrows, { id, x, y, angle: m.startFinish?.angle ?? 0 }] });
      setSel({ kind: "arrow", id }); setTool("select");
      return;
    }
    if (tool === "sf") {
      set({ startFinish: m.startFinish ? { ...m.startFinish, x, y } : { x, y, angle: 0, halfWidth: r1(22 * u), gridBoxes: 6 } });
      setSel({ kind: "sf" }); setTool("select");
      return;
    }

    // Move tool: a leader handle, then whatever item is under the pointer.
    if (target.closest("[data-handle='leader']") && sel?.kind === "label") {
      drag.current = { what: "leader", dx: 0, dy: 0 };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    const item = target.closest("[data-item]")?.getAttribute("data-item") ?? "";
    const [kind, id] = item.split(":");
    const next: Selection = kind === "sf" ? { kind: "sf" } : kind === "label" || kind === "block" || kind === "arrow" ? { kind, id } : null;
    setSel(next);
    const pos = itemPos(next);
    if (pos) {
      drag.current = { what: "item", dx: x - pos[0], dy: y - pos[1] };
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  }

  function move(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || !m || !sel) return;
    const p = at(e);
    if (!p) return;
    if (d.what === "leader" && sel.kind === "label") setLabel(sel.id, { leader: { x: p[0], y: p[1] } });
    else moveTo(sel, r1(p[0] - d.dx), r1(p[1] - d.dy));
  }

  function key(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!sel || e.target !== e.currentTarget) return;
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); remove(sel); return; }
    const step = e.shiftKey ? 10 : 1;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    const pos = itemPos(sel);
    if (d && pos) { e.preventDefault(); moveTo(sel, r1(pos[0] + d[0]), r1(pos[1] + d[1])); }
  }

  const selLabel = m && sel?.kind === "label" ? m.labels.find((l) => l.id === sel.id) : undefined;
  const selBlock = m && sel?.kind === "block" ? m.blocks.find((b) => b.id === sel.id) : undefined;
  const selArrow = m && sel?.kind === "arrow" ? m.arrows.find((a) => a.id === sel.id) : undefined;
  const selSf = m && sel?.kind === "sf" ? m.startFinish : null;
  const full = (t: Tool) =>
    !!m && ((t === "label" && m.labels.length >= MAP_LIMITS.labels) || ((t === "building" || t === "parking" || t === "zone") && m.blocks.length >= MAP_LIMITS.blocks) || (t === "arrow" && m.arrows.length >= MAP_LIMITS.arrows));

  return (
    <div className="space-y-5">
      {/* ------------------------------------------------------------ trace */}
      <div className="rounded-xl border border-white/10 bg-black/20 p-3 sm:p-4">
        <h4 className="text-sm font-semibold text-white/90">1. Trace the track from an overhead photo</h4>
        <p className="mt-1 text-xs text-zinc-500">
          A satellite or drone photo, straight down, with the whole track in frame. Google Maps in satellite view, zoomed to fit the circuit, works well.
        </p>
        <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="space-y-2">
            <AssetField label="Overhead photo" value={draft.image} onChange={(v) => setDraft((d) => ({ ...d, image: v }))} hint="PNG, JPG or WebP. Traced at up to 1200 px." />
            {draft.image && <ColourPicker key={draft.image} src={draft.image} color={draft.color} onPick={(color) => setDraft((d) => ({ ...d, color }))} />}
          </div>
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <span className="h-6 w-6 shrink-0 rounded border border-white/20" style={{ background: hex(draft.color) }} aria-hidden />
              Track colour {hex(draft.color)}
              <span className="text-zinc-500">· click the track in the photo to pick it</span>
            </div>
            <Slider label="Colour tolerance" hint="Higher takes in lighter and darker patches of track; too high spills onto dirt and roads." min={4} max={80} value={draft.tolerance} onChange={(v) => setDraft((d) => ({ ...d, tolerance: v }))} />
            <Slider label="Close gaps" hint="Bridges paint, cars and shadows on the track." min={0} max={12} value={draft.closeGaps} onChange={(v) => setDraft((d) => ({ ...d, closeGaps: v }))} />
            <Slider label="Remove thin bits" hint="Drops paths, ditches and spurs narrower than this." min={0} max={12} value={draft.removeThin} onChange={(v) => setDraft((d) => ({ ...d, removeThin: v }))} />
            <Slider label="Smooth edges" min={1} max={6} value={draft.smooth} onChange={(v) => setDraft((d) => ({ ...d, smooth: v }))} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.curbs} onChange={(e) => setDraft((d) => ({ ...d, curbs: e.target.checked }))} />
              Find red and white curbs
            </label>
            <button type="button" className="btn-primary w-full" disabled={tracing || !draft.image} onClick={trace}>
              {tracing ? "Tracing..." : m ? "Trace again" : "Trace track"}
            </button>
            {traceErr && <p className="text-xs text-red-400">{traceErr}</p>}
            {m && !traceErr && (
              <p className="text-xs text-zinc-500">
                Traced {m.width} × {m.height} px · {m.curbs.length} curb{m.curbs.length === 1 ? "" : "s"}. Tracing again keeps what you placed on the map.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------- edit */}
      <div className="rounded-xl border border-white/10 bg-black/20 p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-white/90">2. Mark up the map</h4>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={() => { if (!m || window.confirm("Replace this map with the built-in one?")) { onChange(CIRCUIT_MAP_DEFAULT); setSel(null); } }}>
              Use built-in map
            </button>
            {m && (
              <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={() => { if (window.confirm("Remove the map? The page then shows the circuit photos only.")) { onChange(null); setSel(null); } }}>
                Remove map
              </button>
            )}
          </div>
        </div>

        {!m ? (
          <p className="py-8 text-center text-sm text-zinc-500">No map: trace one above, or use the built-in map. The page shows the circuit photos only.</p>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap gap-1.5" role="toolbar" aria-label="Map tools">
              {TOOLS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={tool === t.id}
                  disabled={full(t.id)}
                  className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors ${tool === t.id ? "border-cyan-400 bg-cyan-400/15 text-white" : "border-white/15 text-white/80 hover:border-white/30"}`}
                  onClick={() => setTool(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-zinc-500">{TOOLS.find((t) => t.id === tool)?.hint}</p>

            <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
              <div>
                <div
                  ref={wrap}
                  tabIndex={0}
                  aria-label="Circuit map editor"
                  className={`circuit-editor circuit-editor-${tool} rounded-lg`}
                  onPointerDown={down}
                  onPointerMove={move}
                  onPointerUp={() => (drag.current = null)}
                  onPointerCancel={() => (drag.current = null)}
                  onKeyDown={key}
                >
                  <CircuitMap map={m} className="circuit-map" viewBox={`0 0 ${m.width} ${m.height}`} underlay={photo > 0 && m.source?.image ? { href: m.source.image, opacity: photo } : undefined}>
                    {tool === "curbs" && m.curbs.map((d, i) => <path key={i} d={d} data-curb-hit={i} className="circuit-curb-hit" style={{ strokeWidth: 16 * u }} />)}
                    <Highlight map={m} sel={sel} u={u} />
                  </CircuitMap>
                </div>
                <div className="mt-2 flex items-center gap-3 text-xs text-zinc-400">
                  <label htmlFor="circuit-photo-opacity">Photo underneath</label>
                  <input id="circuit-photo-opacity" type="range" min={0} max={1} step={0.05} value={photo} onChange={(e) => setPhoto(Number(e.target.value))} className="w-40" />
                  <span>{Math.round(photo * 100)}%</span>
                  <span className="text-zinc-500">(editor only)</span>
                </div>
              </div>

              {/* --------------------------------------------- selection */}
              <div className="space-y-3 text-sm">
                {!sel && <p className="text-xs text-zinc-500">Select something on the map to change it here. The legend under the map on the page lists only what the map shows.</p>}
                {selLabel && (
                  <Panel title="Label" onRemove={() => remove(sel)}>
                    <div>
                      <label className="label" htmlFor="circuit-label-text">Text</label>
                      <input id="circuit-label-text" className="input h-9" value={selLabel.text} maxLength={MAP_LIMITS.text} onChange={(e) => setLabel(selLabel.id, { text: e.target.value })} />
                    </div>
                    <div className="flex gap-1" role="group" aria-label="Size">
                      {(["s", "m", "l"] as const).map((s) => (
                        <button key={s} type="button" aria-pressed={selLabel.size === s} className={`flex-1 rounded border px-2 py-1 text-xs ${selLabel.size === s ? "border-cyan-400 text-white" : "border-white/15 text-zinc-400"}`} onClick={() => setLabel(selLabel.id, { size: s })}>
                          {{ s: "Small", m: "Medium", l: "Large" }[s]} · {LABEL_PX[s]}
                        </button>
                      ))}
                    </div>
                    <Angle value={selLabel.angle} onChange={(a) => setLabel(selLabel.id, { angle: a })} />
                    <label className="flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={selLabel.soft} onChange={(e) => setLabel(selLabel.id, { soft: e.target.checked })} />
                      Soft (for text on the track)
                    </label>
                    <label className="flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={!!selLabel.leader} onChange={(e) => setLabel(selLabel.id, { leader: e.target.checked ? { x: r1(selLabel.x + 40 * u), y: r1(selLabel.y + 60 * u) } : null })} />
                      Pointer line (drag its round end on the map)
                    </label>
                  </Panel>
                )}
                {selBlock && (
                  <Panel title={KIND_NAME[selBlock.kind]} onRemove={() => remove(sel)}>
                    <div className="flex gap-1" role="group" aria-label="Kind">
                      {(Object.keys(KIND_NAME) as MapBlockKind[]).map((k) => (
                        <button key={k} type="button" aria-pressed={selBlock.kind === k} className={`flex-1 rounded border px-2 py-1 text-xs ${selBlock.kind === k ? "border-cyan-400 text-white" : "border-white/15 text-zinc-400"}`} onClick={() => setBlock(selBlock.id, { kind: k })}>
                          {KIND_NAME[k]}
                        </button>
                      ))}
                    </div>
                    <Slider label="Width" min={4} max={Math.round(m.width * 0.8)} value={Math.round(selBlock.w)} onChange={(w) => setBlock(selBlock.id, { w })} />
                    <Slider label="Depth" min={4} max={Math.round(m.height * 0.5)} value={Math.round(selBlock.h)} onChange={(h) => setBlock(selBlock.id, { h })} />
                    <Angle value={selBlock.angle} onChange={(a) => setBlock(selBlock.id, { angle: a })} />
                  </Panel>
                )}
                {selArrow && (
                  <Panel title="Direction arrow" onRemove={() => remove(sel)}>
                    <Angle value={selArrow.angle} onChange={(a) => setArrow(selArrow.id, a)} flip />
                    {m.startFinish && (
                      <button type="button" className="btn-secondary w-full text-xs" onClick={() => setArrow(selArrow.id, m.startFinish!.angle)}>
                        Match the start/finish direction
                      </button>
                    )}
                  </Panel>
                )}
                {selSf && (
                  <Panel title="Start / finish" onRemove={() => remove(sel)}>
                    <Angle value={selSf.angle} onChange={(a) => set({ startFinish: { ...selSf, angle: a } })} flip hint="The direction cars cross the line. The grid boxes sit behind it." />
                    <Slider label="Track width" min={4} max={150} value={Math.round(selSf.halfWidth * 2)} onChange={(w) => set({ startFinish: { ...selSf, halfWidth: w / 2 } })} />
                    <Slider label="Grid boxes" min={0} max={MAP_LIMITS.gridBoxes} value={selSf.gridBoxes} onChange={(g) => set({ startFinish: { ...selSf, gridBoxes: g } })} />
                  </Panel>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Outline around the selected item, plus the leader handle for a label. */
function Highlight({ map, sel, u }: { map: CircuitMapData; sel: Selection; u: number }) {
  if (!sel) return null;
  if (sel.kind === "sf") {
    const sf = map.startFinish;
    return sf ? <circle cx={sf.x} cy={sf.y} r={sf.halfWidth + 8 * u} className="circuit-sel" /> : null;
  }
  if (sel.kind === "block") {
    const b = map.blocks.find((x) => x.id === sel.id);
    return b ? <rect x={-b.w / 2 - 4 * u} y={-b.h / 2 - 4 * u} width={b.w + 8 * u} height={b.h + 8 * u} transform={`translate(${b.x} ${b.y}) rotate(${b.angle})`} className="circuit-sel" /> : null;
  }
  if (sel.kind === "arrow") {
    const a = map.arrows.find((x) => x.id === sel.id);
    return a ? <circle cx={a.x} cy={a.y} r={24 * u} className="circuit-sel" /> : null;
  }
  const l = map.labels.find((x) => x.id === sel.id);
  if (!l) return null;
  const px = LABEL_PX[l.size] * u;
  const w = l.text.length * px * 0.62 + 12 * u;
  return (
    <>
      <rect x={-w / 2} y={l.soft ? -px * 0.75 : -px * 1.1} width={w} height={px * 1.5} transform={`translate(${l.x} ${l.y}) rotate(${l.angle})`} className="circuit-sel" />
      {l.leader && <circle cx={l.leader.x} cy={l.leader.y} r={7 * u} data-handle="leader" className="circuit-handle" />}
    </>
  );
}

/**
 * Click the photo to read the track colour (a 5 x 5 average, so one stray pixel does
 * not decide it). Keyed by src by its parent, so a new photo starts it afresh.
 */
function ColourPicker({ src, color, onPick }: { src: string; color: [number, number, number]; onPick: (c: [number, number, number]) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const c = canvas.current;
      if (!c) return;
      const scale = Math.min(1, 1200 / Math.max(img.naturalWidth, img.naturalHeight));
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext("2d", { willReadFrequently: true })?.drawImage(img, 0, 0, c.width, c.height);
    };
    img.onerror = () => setErr("Could not load the photo.");
    img.src = src;
  }, [src]);

  function pick(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = e.currentTarget;
    const box = c.getBoundingClientRect();
    const x = Math.round(((e.clientX - box.left) / box.width) * c.width);
    const y = Math.round(((e.clientY - box.top) / box.height) * c.height);
    try {
      const d = c.getContext("2d", { willReadFrequently: true })!.getImageData(Math.max(0, x - 2), Math.max(0, y - 2), 5, 5).data;
      const sum = [0, 0, 0];
      for (let i = 0; i < d.length; i += 4) { sum[0] += d[i]; sum[1] += d[i + 1]; sum[2] += d[i + 2]; }
      const n = d.length / 4;
      onPick([Math.round(sum[0] / n), Math.round(sum[1] / n), Math.round(sum[2] / n)]);
    } catch {
      setErr("This photo's colours cannot be read here; upload it again.");
    }
  }

  return (
    <div>
      <canvas ref={canvas} onPointerDown={pick} className="block h-auto max-h-80 w-auto max-w-full cursor-crosshair rounded-lg border border-white/10" style={{ outline: `3px solid ${hex(color)}`, outlineOffset: -3 }} aria-label="Overhead photo: click the track to pick its colour" />
      {err && <p className="mt-1 text-xs text-red-400">{err}</p>}
    </div>
  );
}

function Panel({ title, onRemove, children }: { title: string; onRemove: () => void; children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-lg border border-cyan-400/30 bg-cyan-400/5 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">{title}</span>
        <button type="button" className="text-xs text-red-300 underline hover:text-red-200" onClick={onRemove}>Remove</button>
      </div>
      {children}
    </div>
  );
}

function Slider({ label, hint, min, max, value, onChange }: { label: string; hint?: string; min: number; max: number; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-white/80">{label}</span>
        <span className="tabular-nums text-zinc-500">{value}</span>
      </div>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full" aria-label={label} />
      {hint && <p className="text-[11px] leading-snug text-zinc-500">{hint}</p>}
    </div>
  );
}

function Angle({ value, onChange, flip, hint }: { value: number; onChange: (v: number) => void; flip?: boolean; hint?: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-white/80">Angle</span>
        <span className="flex items-center gap-2">
          <input type="number" className="input h-7 w-16 px-1 text-right text-xs" min={-180} max={180} step={0.5} value={value} onChange={(e) => onChange(turn(Number(e.target.value) || 0))} aria-label="Angle in degrees" />
          {flip && <button type="button" className="btn-secondary px-2 py-0.5 text-xs" onClick={() => onChange(turn(value + 180))}>Flip</button>}
        </span>
      </div>
      <input type="range" min={-180} max={180} step={0.5} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full" aria-label="Angle" />
      {hint && <p className="text-[11px] leading-snug text-zinc-500">{hint}</p>}
    </div>
  );
}
