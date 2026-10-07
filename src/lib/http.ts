import { NextResponse } from "next/server";
import { z } from "zod";
import { safeErrorMessage } from "./redact";

/** JSON response that is never cached by browsers or proxies. */
export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export function tooMany(retryAfter: number) {
  return json({ error: "too_many_requests", retryAfter }, 429, { "Retry-After": String(retryAfter) });
}

/** Parse and validate a JSON body. Returns the data or a ready-to-return 400 response. */
export async function readBody<T extends z.ZodType>(
  req: Request,
  schema: T,
  maxBytes = 64_000,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; res: NextResponse }> {
  try {
    const text = await req.text();
    if (text.length > maxBytes) return { ok: false, res: json({ error: "too_large" }, 413) };
    const parsed = schema.safeParse(JSON.parse(text || "{}"));
    if (!parsed.success) {
      return { ok: false, res: json({ error: "invalid_input", details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, 400) };
    }
    return { ok: true, data: parsed.data };
  } catch {
    return { ok: false, res: json({ error: "invalid_json" }, 400) };
  }
}

/**
 * Wrap a route handler so unexpected errors become a generic 500 and the real (redacted) error is logged.
 * `secrets` lets stream routes make sure the key can never end up in the log line.
 */
export function guard<A extends unknown[]>(
  name: string,
  fn: (...args: A) => Promise<Response>,
  secretsFor: (...args: A) => string[] = () => [],
) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      console.error(`[api:${name}]`, safeErrorMessage(e, secretsFor(...args)));
      return json({ error: "server_error" }, 500);
    }
  };
}
