import { randomBytes } from "crypto";

/** URL-safe random token for ticket QR codes. 24 bytes = 192 bits of entropy. */
export function newQrToken(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * Token for a drifter's private pre-registration link. Twelve characters from an
 * alphabet without look-alikes (no 0/o, 1/l/i), about 59 bits: unguessable, and
 * still clean enough to read out over the phone if a link gets mangled.
 */
const DRIFTER_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export function newDrifterToken(): string {
  const bytes = randomBytes(12);
  let out = "";
  for (let i = 0; i < 12; i++) out += DRIFTER_ALPHABET[bytes[i] % DRIFTER_ALPHABET.length];
  return out;
}
