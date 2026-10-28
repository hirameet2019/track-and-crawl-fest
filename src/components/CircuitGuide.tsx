import { CircuitMap } from "@/components/CircuitMap";
import { Reveal } from "@/components/Reveal";
import type { GalleryPhoto } from "@/config/site";
import type { CircuitMapData } from "@/lib/circuit-map-types";

/** Map key wording from Settings > Website text; a blank label leaves that entry out. */
export interface MapKeyLabels {
  curbs: string;
  start: string;
  direction: string;
  buildings: string;
  parking: string;
  zones: string;
}

/** The map key lists only what this map actually shows, and only entries with a label. */
function legend(map: CircuitMapData, k: MapKeyLabels) {
  return [
    map.curbs.length > 0 && { key: "curb", label: k.curbs },
    map.startFinish && { key: "flag", label: k.start },
    map.arrows.length > 0 && { key: "arrow", label: k.direction },
    map.blocks.some((b) => b.kind === "building") && { key: "paddock", label: k.buildings },
    map.blocks.some((b) => b.kind === "parking") && { key: "parking", label: k.parking },
    map.blocks.some((b) => b.kind === "zone") && { key: "zone", label: k.zones },
  ].filter((x): x is { key: string; label: string } => !!x && !!x.label);
}

/**
 * The venue band in the event details: the circuit map beside photos of the track
 * and paddock. Both come from Settings > Look > Circuit; either may be empty.
 */
export function CircuitGuide({ title, venueName, photos, map, keys: labels }: { title: string; venueName?: string; photos: GalleryPhoto[]; map: CircuitMapData | null; keys: MapKeyLabels }) {
  if (!map && !photos.length) return null;
  const keys = map ? legend(map, labels) : [];
  return (
    <div className="mx-auto max-w-5xl px-4 pb-16 sm:px-8 md:pb-24">
      <Reveal from="left" className="mb-6">
        {title && <h3 className="info-fact-label">{title}</h3>}
        {venueName && <p className="info-fact-value mt-1">{venueName}</p>}
      </Reveal>
      <div className={`circuit-layout ${map && photos.length ? "" : "circuit-layout-solo"}`}>
        {map && (
          <Reveal from="zoom" className="circuit-card">
            <CircuitMap map={map} className="circuit-map" title={venueName ? `Map of ${venueName}` : "Circuit map"} />
            {keys.length > 0 && (
              <ul className="circuit-legend" aria-label="Map key">
                {keys.map((k) => (
                  <li key={k.key}>
                    <span className={`circuit-key circuit-key-${k.key}`} aria-hidden>{k.key === "arrow" ? "›" : null}</span>
                    {k.label}
                  </li>
                ))}
              </ul>
            )}
          </Reveal>
        )}
        {photos.length > 0 && (
          <ul className={`circuit-photos ${map ? "" : "circuit-photos-solo"}`} aria-label={title || "The circuit"}>
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
