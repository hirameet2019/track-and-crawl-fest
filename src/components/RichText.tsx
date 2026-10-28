import Link from "next/link";
import { Fragment, type ReactNode } from "react";

/**
 * Wording from Admin > Settings, rendered: {name} tokens are filled from `vars`,
 * **double asterisks** become bold, [a label](/path) becomes a link, and a token
 * named in `slots` ({timeLeft}, {statusLink}) is replaced by that element. Unknown
 * tokens stay as typed so a typo shows up on the page instead of vanishing.
 *
 * Links go only to a site path or an http(s) address; anything else stays plain
 * text, so stored wording cannot become a javascript: link.
 */
export function RichText({
  text,
  vars = {},
  slots = {},
  strong,
  link = "underline",
}: {
  text: string;
  vars?: Record<string, string | number>;
  slots?: Record<string, ReactNode>;
  /** Class for the bold parts. */
  strong?: string;
  /** Class for links. */
  link?: string;
}) {
  const filled = text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
  return (
    <>
      {filled.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\)|\{\w+\})/g).map((part, i) => {
        if (/^\*\*[^*]+\*\*$/.test(part)) return <b key={i} className={strong}>{part.slice(2, -2)}</b>;
        const a = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
        if (a) {
          const [, label, href] = a;
          if (/^\/(?!\/)/.test(href)) return <Link key={i} href={href} className={link}>{label}</Link>;
          if (/^https?:\/\//i.test(href)) return <a key={i} href={href} target="_blank" rel="noreferrer" className={link}>{label}</a>;
          return <Fragment key={i}>{label}</Fragment>;
        }
        const slot = /^\{(\w+)\}$/.exec(part)?.[1];
        return <Fragment key={i}>{slot && slot in slots ? slots[slot] : part}</Fragment>;
      })}
    </>
  );
}
