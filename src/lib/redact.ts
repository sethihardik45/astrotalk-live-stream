/**
 * Keep stream keys out of logs, the database, and error messages.
 *
 * Use `redact(text, secrets)` on ANY text that might contain a destination URL or key before it
 * is logged, stored or returned to a browser.
 */

const RTMP_URL = /rtmps?:\/\/[^\s"'<>)]+/gi;
const KEY_FIELD = /("?(?:stream[_-]?key|streamKey|key)"?\s*[:=]\s*)("?)[^\s"',}]+/gi;

export function redact(text: string, secrets: Array<string | undefined | null> = []): string {
  let out = String(text);
  for (const s of secrets) {
    if (s && s.length >= 4) out = out.split(s).join("[redacted]");
  }
  out = out.replace(RTMP_URL, "[redacted-rtmp-url]");
  out = out.replace(KEY_FIELD, "$1$2[redacted]");
  return out;
}

/** Turn anything thrown into a short, key-free string. */
export function safeErrorMessage(e: unknown, secrets: Array<string | undefined | null> = []): string {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "Unknown error";
  return redact(raw, secrets).slice(0, 300);
}
