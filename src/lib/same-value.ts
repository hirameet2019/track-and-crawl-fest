/** Canonical JSON: object keys sorted, undefined dropped, so key order never reads as a change. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/**
 * Whether two values differ, ignoring key order. Saved settings come back from
 * the server in schema order, which differs from the order a form built them in;
 * a plain JSON.stringify comparison would call that a change.
 */
export const changed = (a: unknown, b: unknown): boolean => canonical(a) !== canonical(b);

/** An ISO timestamp as its instant, so "…T00:00:00+00:00" and "…T00:00:00.000Z" compare equal. */
const instant = (v: unknown): unknown =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) && !Number.isNaN(Date.parse(v)) ? Date.parse(v) : v;

/**
 * Keys of `after` whose value differs from `before`, for the audit trail. Ignores
 * key order and timestamp formatting: the database returns "+00:00" offsets while
 * the app writes "Z", and the same moment must not be logged as a change.
 */
export function changedKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return Object.keys(after).filter((k) => changed(instant(before[k]), instant(after[k])));
}
