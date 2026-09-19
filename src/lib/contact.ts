/**
 * Buyer contact helpers shared by the order form (live hints) and the server
 * action (final validation). Keep them dependency-free so both sides agree.
 */

/** Canonical PH mobile: 11 digits, "09" + 9 digits. */
export const MOBILE_RE = /^09\d{9}$/;

/**
 * Digits only, with the country-code forms folded into the local one:
 *   "+63 917 123 4567" / "63917..." -> "09171234567"
 *   "917 123 4567" (leading 0 dropped) -> "09171234567"
 * Anything else is returned as bare digits so the caller can explain what is off.
 */
export function normalizeMobile(raw: string): string {
  let d = raw.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("63")) d = "0" + d.slice(2);
  if (d.length === 10 && d.startsWith("9")) d = "0" + d;
  return d;
}

/** Human-readable reason the number is not accepted yet, or null when it is fine (or still empty). */
export function mobileProblem(raw: string): string | null {
  const d = normalizeMobile(raw);
  if (!d) return null;
  if (!d.startsWith("09")) return "PH mobile numbers start with 09 (or +63 9...)";
  if (d.length < 11) return `${d.length} of 11 digits, check for a missing digit`;
  if (d.length > 11) return `${d.length} digits, PH mobile numbers have 11`;
  return null;
}

const COMMON_DOMAINS = ["gmail.com", "yahoo.com", "yahoo.com.ph", "outlook.com", "hotmail.com", "icloud.com", "live.com", "proton.me", "protonmail.com"];

/**
 * Trim, lowercase, drop stray spaces and full-width "＠" that phone keyboards
 * insert. Both the form and the server run this, so the stored address is the
 * one the buyer actually sees on the review screen.
 */
export function normalizeEmail(raw: string): string {
  return raw.replace(/＠/g, "@").replace(/\s+/g, "").trim().toLowerCase();
}

/** ".con", ".cm" and friends: the address is well-formed but nobody lives there. */
const TLD_TYPOS: Record<string, string> = {
  con: "com", cm: "com", cmo: "com", ocm: "com", cpm: "com", clm: "com", cim: "com", vom: "com", xom: "com", comm: "com", coom: "com", om: "com", co: "com",
  nett: "net", ner: "net", ogr: "org", prg: "org",
};

/**
 * Human-readable reason the address will not work, or null when it looks
 * deliverable (or is still empty). Stricter than the HTML "email" type on
 * purpose: the ticket PDF is only ever sent here, there is no second chance.
 */
export function emailProblem(raw: string): string | null {
  const e = normalizeEmail(raw);
  if (!e) return null;
  if (/\s/.test(raw.trim())) return "Remove the space in the email address";
  const at = e.split("@");
  if (at.length < 2) return "Missing @ in the email address";
  if (at.length > 2) return "Only one @ is allowed";
  const [local, domain] = at;
  if (!local) return "Type the part before the @";
  if (!domain) return "Type the part after the @, e.g. gmail.com";
  if (!/^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+$/.test(local)) return "The part before @ has a character that is not allowed";
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return "Dots cannot start, end, or repeat before the @";
  if (!domain.includes(".")) return `"${domain}" is missing its ending, e.g. gmail.com`;
  if (domain.includes("..") || domain.startsWith(".") || domain.endsWith(".") || domain.startsWith("-") || domain.endsWith("-")) return "Check the dots in the domain";
  if (!/^[a-z0-9.-]+$/.test(domain)) return "The domain has a character that is not allowed";
  const labels = domain.split(".");
  const tld = labels[labels.length - 1];
  if (TLD_TYPOS[tld]) return `".${tld}" is not a real ending, did you mean ".${TLD_TYPOS[tld]}"?`;
  if (!/^[a-z]{2,}$/.test(tld)) return "The email ending should be letters only, e.g. .com or .ph";
  if (domain === "gmail.com") {
    const bare = local.replace(/\./g, "");
    if (!/^[a-z0-9]+$/.test(bare)) return "Gmail addresses only use letters, numbers and dots before the @";
  }
  return null;
}

/** True when both boxes hold the same deliverable address. */
export function emailsMatch(a: string, b: string): boolean {
  return normalizeEmail(a) !== "" && normalizeEmail(a) === normalizeEmail(b);
}

function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/**
 * Catch "gmail.cim", "yahoo.con", "outlok.com" before the tickets are mailed
 * into the void. Suggests a fix only for near misses (edit distance <= 2) of the
 * common consumer domains; company domains are left alone.
 */
export function suggestEmail(email: string): string | null {
  const m = normalizeEmail(email).match(/^([^@\s]+)@([^@\s]+\.[^@\s]+)$/);
  if (!m) return null;
  const [, local, domain] = m;
  if (COMMON_DOMAINS.includes(domain)) return null;
  let best: string | null = null;
  let bestDistance = 3;
  for (const candidate of COMMON_DOMAINS) {
    const d = editDistance(domain, candidate);
    if (d < bestDistance) {
      bestDistance = d;
      best = candidate;
    }
  }
  return best ? `${local}@${best}` : null;
}
