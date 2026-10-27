import { Fragment, type ReactNode } from "react";

/**
 * Wording from Admin > Settings, rendered: {name} tokens are filled from `vars`,
 * **double asterisks** become bold, and a token named in `slots` ({timeLeft},
 * {statusLink}) is replaced by that element. Unknown tokens stay as typed so a
 * typo shows up on the page instead of vanishing.
 */
export function RichText({ text, vars = {}, slots = {} }: { text: string; vars?: Record<string, string | number>; slots?: Record<string, ReactNode> }) {
  const filled = text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
  return (
    <>
      {filled.split(/(\*\*[^*]+\*\*|\{\w+\})/g).map((part, i) => {
        if (/^\*\*[^*]+\*\*$/.test(part)) return <b key={i}>{part.slice(2, -2)}</b>;
        const slot = /^\{(\w+)\}$/.exec(part)?.[1];
        return <Fragment key={i}>{slot && slot in slots ? slots[slot] : part}</Fragment>;
      })}
    </>
  );
}
