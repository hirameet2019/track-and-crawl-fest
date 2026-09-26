import type { RuleLine } from "@/lib/drifter-rules";

/**
 * The wristband rules, one language per line behind a fixed-width tag, so staff
 * and drifters find their language without reading the other two. The tag column
 * fits "TAGALOG"; on a phone the tag sits above its line instead, so the text
 * keeps the full width of the card.
 */
export function RuleLines({ lines, strong = "text-zinc-100" }: { lines: RuleLine[]; strong?: string }) {
  return (
    <>
      {lines.map(([lang, text]) => (
        <span key={lang} className="grid gap-x-3 py-0.5 sm:grid-cols-[3.5rem_minmax(0,1fr)]">
          <span className="pt-0.5 text-[10px] font-semibold uppercase leading-4 tracking-wide text-zinc-500">{lang}</span>
          <span className={lang === "EN" ? strong : "text-zinc-400"}>{text}</span>
        </span>
      ))}
    </>
  );
}

/** "Wristband rules · Patakaran sa wristband · 手环规则", wrapping between languages, never inside one. */
export function RulesHeading({ as: Tag = "h2" }: { as?: "h2" | "h3" }) {
  return (
    <Tag className="flex flex-wrap gap-x-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-300">
      <span className="whitespace-nowrap">Wristband rules</span>
      <span aria-hidden className="text-zinc-500">&middot;</span>
      <span className="whitespace-nowrap">Patakaran sa wristband</span>
      <span aria-hidden className="text-zinc-500">&middot;</span>
      <span className="whitespace-nowrap">手环规则</span>
    </Tag>
  );
}
