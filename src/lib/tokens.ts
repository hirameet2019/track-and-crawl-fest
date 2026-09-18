import { randomBytes } from "crypto";

/** URL-safe random token for ticket QR codes. 24 bytes = 192 bits of entropy. */
export function newQrToken(): string {
  return randomBytes(24).toString("base64url");
}
