import { useId } from "react";
import { alongLine, LABEL_PX, mapViewBox, type CircuitMapData, type MapLabel } from "@/lib/circuit-map-types";

const f1 = (v: number) => Math.round(v * 10) / 10;
const place = (x: number, y: number, angle = 0, scale = 1) =>
  `translate(${f1(x)} ${f1(y)})${angle ? ` rotate(${f1(angle)})` : ""}${scale !== 1 ? ` scale(${f1(scale * 100) / 100})` : ""}`;

/** Where a label's leader line starts: just under or over the text, toward its target. */
function leaderStart(l: MapLabel, u: number): [number, number] {
  const px = LABEL_PX[l.size] * u;
  const half = (l.text.length * px * 0.62) / 2;
  const dx = Math.max(-half, Math.min(half, (l.leader?.x ?? l.x) - l.x));
  return [l.x + dx, (l.leader?.y ?? l.y) > l.y ? l.y + px * 0.35 : l.y - px];
}

/**
 * The circuit map, drawn from settings: the traced asphalt and curbs, then the
 * start/finish line, arrows, paddock blocks and labels placed on top. Colours come
 * from the Settings palette. Sizes scale with the traced track (--u), so a photo
 * traced at another resolution keeps the same proportions.
 *
 * The map editor reuses this with the full photo as the viewBox, the photo
 * underneath, and its handles as children; every item carries data-item for it.
 */
export function CircuitMap({
  map,
  className,
  viewBox,
  underlay,
  children,
  title = "Circuit map",
}: {
  map: CircuitMapData;
  className?: string;
  viewBox?: string;
  underlay?: { href: string; opacity: number };
  children?: React.ReactNode;
  title?: string;
}) {
  const checker = useId().replace(/:/g, "");
  const u = Math.max(map.bounds[2], map.bounds[3]) / 880 || 1;
  const sf = map.startFinish;
  const k = sf ? sf.halfWidth / 22 : u;

  return (
    <svg viewBox={viewBox ?? mapViewBox(map)} className={className} role="img" aria-label={title} style={{ "--u": u } as React.CSSProperties}>
      <defs>
        <pattern id={checker} width="8" height="8" patternUnits="userSpaceOnUse">
          <rect width="8" height="8" className="circuit-checker-light" />
          <rect width="4" height="4" className="circuit-checker-dark" />
          <rect x="4" y="4" width="4" height="4" className="circuit-checker-dark" />
        </pattern>
      </defs>
      {underlay && <image href={underlay.href} width={map.width} height={map.height} opacity={underlay.opacity} preserveAspectRatio="none" />}

      {/* Paddock and other blocks sit under the track */}
      {map.blocks.map((b) => (
        <rect
          key={b.id}
          data-item={`block:${b.id}`}
          x={f1(-b.w / 2)}
          y={f1(-b.h / 2)}
          width={f1(b.w)}
          height={f1(b.h)}
          rx={b.kind === "zone" ? f1(Math.min(b.w, b.h) / 2) : 3}
          transform={place(b.x, b.y, b.angle)}
          className={`circuit-${b.kind}`}
        />
      ))}

      <path d={map.asphalt} fillRule="evenodd" className="circuit-shadow" transform={`translate(${f1(4 * u)} ${f1(7 * u)})`} />
      <path d={map.asphalt} fillRule="evenodd" className="circuit-asphalt" data-item="asphalt" />
      {map.curbs.map((d, i) => (
        <g key={i} data-item={`curb:${i}`}>
          <path d={d} className="circuit-curb-base" />
          <path d={d} className="circuit-curb-stripe" />
        </g>
      ))}

      {sf && (
        <g data-item="sf">
          {Array.from({ length: sf.gridBoxes }, (_, i) => {
            const [x, y] = alongLine(sf, -(30 + i * 24) * k, (i % 2 ? 8 : -8) * k);
            return <path key={i} d="M-3 -5H3V5H-3" transform={place(x, y, sf.angle, k)} className="circuit-grid" />;
          })}
          <rect x="-4" y="-22" width="8" height="44" fill={`url(#${checker})`} transform={place(sf.x, sf.y, sf.angle, k)} />
        </g>
      )}
      {map.arrows.map((a) => (
        <g key={a.id} data-item={`arrow:${a.id}`} transform={place(a.x, a.y, a.angle, k)} className="circuit-arrow">
          <path d="M-17 -9L-5 0L-17 9" />
          <path d="M1 -9L13 0L1 9" />
        </g>
      ))}

      {map.labels.map((l) => {
        const start = l.leader ? leaderStart(l, u) : null;
        return (
          <g key={l.id} data-item={`label:${l.id}`}>
            {l.leader && start && <path d={`M${f1(start[0])} ${f1(start[1])}L${f1(l.leader.x)} ${f1(l.leader.y)}`} className="circuit-leader" />}
            <text
              transform={place(l.x, l.y, l.angle)}
              className={`circuit-label ${l.soft ? "circuit-label-soft" : ""}`}
              style={{ fontSize: f1(LABEL_PX[l.size] * u) }}
              textAnchor="middle"
              dominantBaseline={l.soft ? "central" : undefined}
            >
              {l.text}
            </text>
          </g>
        );
      })}
      {children}
    </svg>
  );
}
