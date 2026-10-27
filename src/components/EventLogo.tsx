/**
 * Clean vector recreation of the "MEET & DRIFT 3 - FINAL ROUND" wordmark from the
 * poster. Pure SVG + gradients, so it is crisp at any size. Font: Orbitron 900
 * (loaded in app/layout.tsx), skewed for the italic racing look.
 *
 * Layer order per word (back to front): soft glow, dark outline, white inline,
 * gradient face, glossy highlight on the upper half.
 */
const base = { fontSize: 124, lengthAdjust: "spacingAndGlyphs" as const };

function Word({
  x, y, text, textLength, face, outline, glow,
}: { x: number; y: number; text: string; textLength: number; face: string; outline: string; glow: string }) {
  return (
    <g>
      {/* glow */}
      <text {...base} x={x} y={y} textLength={textLength} fill={glow} opacity="0.55" filter="url(#ml-blur)">{text}</text>
      {/* dark outline */}
      <text {...base} x={x} y={y} textLength={textLength} fill={outline} stroke={outline} strokeWidth="22" strokeLinejoin="round" paintOrder="stroke">{text}</text>
      {/* white inline */}
      <text {...base} x={x} y={y} textLength={textLength} fill="#fff" stroke="#fff" strokeWidth="9" strokeLinejoin="round" paintOrder="stroke">{text}</text>
      {/* gradient face */}
      <text {...base} x={x} y={y} textLength={textLength} fill={face}>{text}</text>
      {/* gloss: upper half lighter */}
      <text {...base} x={x} y={y} textLength={textLength} fill="url(#ml-gloss)">{text}</text>
    </g>
  );
}

export function EventLogo({ className = "", subtitle = "FINAL ROUND" }: { className?: string; subtitle?: string | null }) {
  return (
    <svg
      viewBox="0 0 1000 300"
      role="img"
      aria-label={`Meet & Drift 3 ${subtitle ?? ""}`.trim()}
      className={className}
      style={{ fontFamily: "var(--font-display), 'Arial Black', Impact, sans-serif", fontWeight: 900, overflow: "visible" }}
    >
      <defs>
        <linearGradient id="ml-pink" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe9fb" />
          <stop offset="0.45" stopColor="#ff7de9" />
          <stop offset="0.8" stopColor="#e23cff" />
          <stop offset="1" stopColor="#8a12d6" />
        </linearGradient>
        <linearGradient id="ml-gc" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#3dff4a" />
          <stop offset="0.5" stopColor="#8dffb3" />
          <stop offset="0.78" stopColor="#5cf3ff" />
          <stop offset="1" stopColor="#00cfff" />
        </linearGradient>
        <linearGradient id="ml-gold" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff1a8" />
          <stop offset="0.5" stopColor="#ffd23f" />
          <stop offset="1" stopColor="#ff9a2e" />
        </linearGradient>
        <linearGradient id="ml-gloss" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="0.48" stopColor="#ffffff" stopOpacity="0.12" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="1" stopColor="#000000" stopOpacity="0.18" />
        </linearGradient>
        <filter id="ml-blur" x="-20%" y="-40%" width="140%" height="180%">
          <feGaussianBlur stdDeviation="14" />
        </filter>
        <filter id="ml-shadow" x="-10%" y="-20%" width="120%" height="150%">
          <feDropShadow dx="0" dy="8" stdDeviation="6" floodColor="#000" floodOpacity="0.7" />
        </filter>
      </defs>

      <g transform="skewX(-14) translate(46 0)" filter="url(#ml-shadow)">
        <Word x={30} y={118} text="MEET" textLength={630} face="url(#ml-pink)" outline="#4a0650" glow="#ff5fd9" />
        <Word x={690} y={118} text="&" textLength={150} face="url(#ml-pink)" outline="#4a0650" glow="#ff5fd9" />
        <Word x={70} y={232} text="DRIFT 3" textLength={860} face="url(#ml-gc)" outline="#04353a" glow="#39f0ff" />

        {subtitle && (
          <g>
            <g stroke="url(#ml-gold)" strokeWidth="6" strokeLinecap="round" opacity="0.95">
              <line x1="80" y1="274" x2="160" y2="274" />
              <line x1="176" y1="274" x2="216" y2="274" />
              <line x1="232" y1="274" x2="250" y2="274" />
              <line x1="780" y1="274" x2="798" y2="274" />
              <line x1="814" y1="274" x2="854" y2="274" />
              <line x1="870" y1="274" x2="950" y2="274" />
            </g>
            <text x="515" y="289" fontSize="46" textAnchor="middle" textLength="500" lengthAdjust="spacingAndGlyphs" fill="#3a2400" stroke="#3a2400" strokeWidth="12" strokeLinejoin="round" paintOrder="stroke">{subtitle}</text>
            <text x="515" y="289" fontSize="46" textAnchor="middle" textLength="500" lengthAdjust="spacingAndGlyphs" fill="url(#ml-gold)">{subtitle}</text>
          </g>
        )}
      </g>
    </svg>
  );
}
