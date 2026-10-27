import { Reveal } from "@/components/Reveal";
import { CIRCUIT_MAP as M } from "@/config/circuit-map";
import type { GalleryPhoto } from "@/config/site";

/** A point on the main straight: `s` along the direction of travel from the start/finish line, `off` to its right. */
function along(s: number, off = 0): [number, number] {
  const a = (M.straightAngle * Math.PI) / 180;
  const ux = Math.cos(a), uy = Math.sin(a);
  return [M.startFinish.x + ux * s - uy * off, M.startFinish.y + uy * s + ux * off];
}

const at = ([x, y]: [number, number], rotate = 0) => `translate(${x.toFixed(1)} ${y.toFixed(1)})${rotate ? ` rotate(${rotate})` : ""}`;

/**
 * The circuit layout. The asphalt and curbs are traced from a satellite image
 * (src/config/circuit-map.ts); colours come from the Settings palette, so the map
 * follows the event's look like the rest of the page.
 */
export function CircuitMap({ className }: { className?: string }) {
  const { halfWidth } = M.startFinish;
  const angle = M.straightAngle;
  const sfTop = along(0, -halfWidth);
  const callout: [number, number] = [470, 26];
  return (
    <svg viewBox={M.viewBox} className={className} role="img" aria-labelledby="circuit-map-title circuit-map-desc">
      <title id="circuit-map-title">Circuit map</title>
      <desc id="circuit-map-desc">
        Top view of the circuit: the main straight runs along the paddock at the top, with the start and finish line just before the
        pit building. The track then sweeps down the right side and winds back through hairpins, esses and an inner spiral.
      </desc>
      <defs>
        <pattern id="circuit-checker" width="8" height="8" patternUnits="userSpaceOnUse">
          <rect width="8" height="8" className="circuit-checker-light" />
          <rect width="4" height="4" className="circuit-checker-dark" />
          <rect x="4" y="4" width="4" height="4" className="circuit-checker-dark" />
        </pattern>
      </defs>

      {/* Paddock behind the pit strip */}
      <rect x={M.parking[0]} y={M.parking[1]} width={M.parking[2]} height={M.parking[3]} rx="4" className="circuit-parking" />
      {M.buildings.map(([x, y, w, h]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={w} height={h} rx="3" className="circuit-building" />
      ))}
      <path d={M.pitStrip} className="circuit-pit" />

      {/* The asphalt: a soft drop shadow, then the surface with its edge line */}
      <path d={M.asphalt} fillRule="evenodd" className="circuit-shadow" transform="translate(4 7)" />
      <path d={M.asphalt} fillRule="evenodd" className="circuit-asphalt" />
      {M.curbs.map((d, i) => (
        <g key={i}>
          <path d={d} className="circuit-curb-base" />
          <path d={d} className="circuit-curb-stripe" />
        </g>
      ))}

      {/* Grid boxes, the start/finish line and the direction of travel */}
      {M.grid.map(([x, y], i) => (
        <path key={i} d="M-3 -5H3V5H-3" transform={at([x, y], angle)} className="circuit-grid" />
      ))}
      <rect x="-4" y={-halfWidth} width="8" height={halfWidth * 2} fill="url(#circuit-checker)" transform={at(along(0), angle)} />
      {[70, 88].map((s) => (
        <path key={s} d="M-8 -9L4 0L-8 9" transform={at(along(s), angle)} className="circuit-arrow" />
      ))}

      {/* Labels */}
      <text transform={at(along(200), angle)} className="circuit-label circuit-label-track" textAnchor="middle" dominantBaseline="central">
        Main straight
      </text>
      <path d={`M${callout[0] + 52} ${callout[1] + 8}L${sfTop[0] - 6} ${sfTop[1] - 6}`} className="circuit-leader" />
      <text x={callout[0]} y={callout[1]} className="circuit-label" textAnchor="middle">
        Start / finish
      </text>
      <text x="694" y="122" className="circuit-label circuit-label-zone" textAnchor="middle">
        Paddock
      </text>
      <text x={M.parking[0] + M.parking[2] / 2} y={M.parking[1] + M.parking[3] / 2} className="circuit-label circuit-label-small" textAnchor="middle" dominantBaseline="central">
        Parking
      </text>
    </svg>
  );
}

/** The venue band: the circuit map beside photos of the track and the paddock. */
export function CircuitGuide({ title, venueName, photos }: { title: string; venueName?: string; photos: GalleryPhoto[] }) {
  return (
    <div className="mx-auto max-w-5xl px-4 pb-16 sm:px-8 md:pb-24">
      <Reveal from="left" className="mb-6">
        {title && <h3 className="info-fact-label">{title}</h3>}
        {venueName && <p className="info-fact-value mt-1">{venueName}</p>}
      </Reveal>
      <div className={`circuit-layout ${photos.length ? "" : "circuit-layout-solo"}`}>
        <Reveal from="zoom" className="circuit-card">
          <CircuitMap className="circuit-map" />
          <ul className="circuit-legend" aria-label="Map key">
            <li><span className="circuit-key circuit-key-curb" aria-hidden />Curbs</li>
            <li><span className="circuit-key circuit-key-flag" aria-hidden />Start / finish</li>
            <li><span className="circuit-key circuit-key-arrow" aria-hidden>›</span>Direction</li>
            <li><span className="circuit-key circuit-key-paddock" aria-hidden />Paddock</li>
          </ul>
        </Reveal>
        {photos.length > 0 && (
          <ul className="circuit-photos" aria-label={title || "The circuit"}>
            {photos.map((p, i) => (
              <Reveal key={p.src} as="li" from="zoom" delay={120 + i * 80} className="circuit-photo">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.src} alt={p.alt} loading="lazy" decoding="async" style={p.position ? { objectPosition: p.position } : undefined} />
              </Reveal>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
