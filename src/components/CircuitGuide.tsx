import { CircuitMap } from "@/components/CircuitMap";
import { Reveal } from "@/components/Reveal";
import type { GalleryPhoto } from "@/config/site";
import type { CircuitMapData } from "@/lib/circuit-map-types";

/** The map key lists only what this map actually shows. */
function legend(map: CircuitMapData) {
  return [
    map.curbs.length > 0 && { key: "curb", label: "Curbs" },
    map.startFinish && { key: "flag", label: "Start / finish" },
    map.arrows.length > 0 && { key: "arrow", label: "Direction" },
    map.blocks.some((b) => b.kind === "building") && { key: "paddock", label: "Buildings" },
  ].filter((x): x is { key: string; label: string } => !!x);
}

/**
 * The venue band in the event details: the circuit map beside photos of the track
 * and paddock. Both come from Settings > Look > Circuit; either may be empty.
 */
export function CircuitGuide({ title, venueName, photos, map }: { title: string; venueName?: string; photos: GalleryPhoto[]; map: CircuitMapData | null }) {
  if (!map && !photos.length) return null;
  const keys = map ? legend(map) : [];
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
