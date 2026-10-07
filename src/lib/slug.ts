import { randomBytes } from "node:crypto";

/**
 * The personal link is /live/<slug>. The slug IS the password, so it must be unguessable:
 * 24 random bytes from the operating system's secure generator = 192 bits, encoded as
 * 32 URL-safe characters (A-Z a-z 0-9 - _). Never sequential, never derived from the name.
 */
export const SLUG_BYTES = 24;

export function generateSlug(): string {
  return randomBytes(SLUG_BYTES).toString("base64url");
}

/** Cheap shape check used to reject obvious garbage before touching the database. */
export function looksLikeSlug(s: unknown): s is string {
  return typeof s === "string" && /^[A-Za-z0-9_-]{24,64}$/.test(s);
}
