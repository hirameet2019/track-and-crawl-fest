/**
 * The event's logo: the uploaded image when Settings has one, otherwise the event
 * name set as a type lockup in the display face. The words after " & " take the
 * first accent, the way the poster paints "CRAWL" red, so a name like
 * "Track & Crawl Fest 2026" reads as a lockup and not as plain text.
 */
export function SiteLogo({ src, name, className = "", size = "md" }: { src: string; name: string; className?: string; size?: "sm" | "md" | "xl" }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={name} className={className} />;
  }
  const [lead, tail] = name.includes(" & ") ? [name.slice(0, name.indexOf(" & ") + 2), name.slice(name.indexOf(" & ") + 3)] : [name, ""];
  return (
    <span className={`site-logo site-logo-${size} ${className}`} role="img" aria-label={name}>
      <span aria-hidden>{lead}</span>
      {tail && <span aria-hidden className="site-logo-accent"> {tail}</span>}
    </span>
  );
}
