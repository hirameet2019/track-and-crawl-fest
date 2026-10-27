import { LOCALE } from "@/config/site";
import { getSiteSettings } from "@/lib/site-settings";
import { Reveal } from "@/components/Reveal";
import type { EventRow } from "@/lib/supabase/types";

const fmtTime = (d: Date) => d.toLocaleTimeString(LOCALE.locale, { hour: "numeric", minute: "2-digit", timeZone: LOCALE.timeZone }).replace(":00", "").replace(/\s/g, "").toUpperCase();

/** "7AM - 5PM": the start from the event row, the end from Settings (a wall-clock time on the event day). */
function hours(startsAt: string | null, endTime: string): string | null {
  if (!startsAt) return null;
  const start = new Date(startsAt);
  if (!endTime) return fmtTime(start);
  const ymd = start.toLocaleDateString("en-CA", { timeZone: LOCALE.timeZone });
  const end = new Date(`${ymd}T${endTime}:00${LOCALE.utcOffset}`);
  return `${fmtTime(start)} – ${fmtTime(end)}`;
}

const Icon = {
  pin: <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0113 0c0 5.4-6.5 11-6.5 11zm0-8.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />,
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4M7.5 14h2M11 14h2M14.5 14h2M7.5 17h2M11 17h2" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3.2 2" /></>,
};

function Fact({ icon, label, value, sub, children }: { icon: keyof typeof Icon; label: string; value: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="info-fact">
      <svg viewBox="0 0 24 24" className="info-fact-icon" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>{Icon[icon]}</svg>
      <div className="min-w-0">
        <dt className="info-fact-label">{label}</dt>
        <dd className="info-fact-value">{value}</dd>
        {sub && <dd className="info-fact-sub">{sub}</dd>}
        {children}
      </div>
    </div>
  );
}

/**
 * The event, set the way the poster sets it: venue, date and time in big condensed
 * italics with red line icons, the tagline as a brush-underlined statement, then the
 * presenters and sponsors. Everything comes from the event row and Settings.
 */
export async function EventInfo({ event }: { event: EventRow }) {
  const site = await getSiteSettings();
  const start = event.starts_at ? new Date(event.starts_at) : null;
  const date = start ? start.toLocaleDateString(LOCALE.locale, { month: "short", day: "numeric", year: "numeric", timeZone: LOCALE.timeZone }).toUpperCase() : "Date to be announced";
  const weekday = start ? start.toLocaleDateString(LOCALE.locale, { weekday: "long", timeZone: LOCALE.timeZone }) : undefined;
  const time = hours(event.starts_at, site.info.endTime);
  // The venue row: first comma part large, the rest as the line under it.
  const [place, ...rest] = (event.venue ?? "").split(",").map((x) => x.trim());
  const maps = event.venue ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.venue)}` : null;

  return (
    <section id="info" aria-labelledby="info-title" className="info-section">
      <div className="mx-auto grid max-w-5xl gap-12 px-4 py-16 sm:px-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] md:items-center md:gap-16 md:py-24">
        <Reveal from="left">
          <h2 id="info-title" className="sr-only">Event details</h2>
          <dl className="space-y-8">
            {event.venue && (
              <Fact icon="pin" label="Venue" value={place} sub={rest.join(", ") || undefined}>
                {maps && <dd className="mt-2"><a href={maps} target="_blank" rel="noreferrer" className="info-link">Open in Google Maps</a></dd>}
              </Fact>
            )}
            <Fact icon="calendar" label="Event date" value={date} sub={weekday} />
            {time && <Fact icon="clock" label="Time" value={time} />}
          </dl>
        </Reveal>
        <Reveal from="right" className="space-y-10">
          {event.tagline && <p className="info-tagline">{event.tagline}</p>}
          {site.info.presentedBy && (
            <div>
              <div className="info-fact-label">Presented by</div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={site.info.presentedBy} alt="Event presenters" className="mt-3 h-auto w-full max-w-md" />
            </div>
          )}
        </Reveal>
      </div>
      {site.gallery.photos.length > 0 && (
        <div className="mx-auto max-w-5xl px-4 pb-16 sm:px-8 md:pb-24">
          {site.gallery.title && (
            <Reveal from="left" className="mb-5">
              <h3 className="info-fact-label">{site.gallery.title}</h3>
            </Reveal>
          )}
          {/* The first photo is the large tile; the last spans the row on phones so the grid closes evenly. */}
          <ul className="info-gallery" aria-label={site.gallery.title || "Photos from past events"}>
            {site.gallery.photos.map((p, i) => (
              <Reveal key={p.src} as="li" from="zoom" delay={i * 70} className="info-gallery-tile">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.src} alt={p.alt} loading="lazy" decoding="async" style={p.position ? { objectPosition: p.position } : undefined} />
              </Reveal>
            ))}
          </ul>
        </div>
      )}
      {site.info.sponsors && (
        <div className="mx-auto max-w-5xl px-4 pb-14 sm:px-8">
          <div className="checker" aria-hidden />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={site.info.sponsors} alt="Event sponsors" className="mt-8 h-auto w-full" />
        </div>
      )}
    </section>
  );
}
