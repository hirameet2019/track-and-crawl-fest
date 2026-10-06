import { NOTES } from "@/config/site";

/**
 * Short code a drifter shows at the desk, from the first six characters of their
 * link token. Kept apart from lib/tokens (node crypto) so client screens can use it.
 */
export function drifterReference(token: string, prefix: string = NOTES.drifterReferencePrefix): string {
  return `${prefix}-${token.slice(0, 6).toUpperCase()}`;
}

/** The private pre-registration link for a drifter entry. */
export function drifterLink(siteUrl: string, token: string): string {
  return `${siteUrl.replace(/\/$/, "")}/d/${token}`;
}
