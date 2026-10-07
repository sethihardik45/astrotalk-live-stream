import { z } from "zod";
import { requireOps } from "./auth";
import { StreamError } from "./egressControl";
import { guard, json, tooMany } from "./http";
import { clientIp, rateLimit } from "./ratelimit";
import { safeErrorMessage } from "./redact";
import { ShiftError } from "./shifts";
import { StageError } from "./stageControl";

/**
 * Wraps an ops POST route so every one gets the same protection:
 *   login required → same-origin check → rate limit → input validation (zod) → friendly errors → no secrets in error text.
 * Errors thrown on purpose (StreamError, StageError, ShiftError) become a 400 with a plain-English message.
 */
type RouteCtx = { params?: Promise<Record<string, string>> };

export function opsPost<T extends z.ZodType>(
  name: string,
  schema: T,
  fn: (ctx: { body: z.infer<T>; ip: string; params: Record<string, string> }) => Promise<Record<string, unknown> | void>,
) {
  return guard(`ops/${name}`, async (req: Request, routeCtx?: RouteCtx) => {
    const auth = requireOps(req);
    if (!auth.ok) return auth.res;
    const rl = rateLimit(`ops:${name}:${auth.session.sub}`, 120, 60_000);
    if (!rl.ok) return tooMany(rl.retryAfter);

    let raw: unknown = {};
    try {
      const text = await req.text();
      if (text.length > 100_000) return json({ error: "too_large" }, 413);
      raw = text ? JSON.parse(text) : {};
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return json({ error: "invalid_input", message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, 400);

    // Anything the request carried that could be a secret, so it can be scrubbed from error text.
    const b = parsed.data as Record<string, unknown>;
    const secrets = [b?.streamKey, b?.serverUrl].filter((x): x is string => typeof x === "string");

    try {
      const result = await fn({ body: parsed.data, ip: clientIp(req), params: (await routeCtx?.params) ?? {} });
      return json({ ok: true, ...(result ?? {}) });
    } catch (e) {
      if (e instanceof StreamError || e instanceof StageError || e instanceof ShiftError) {
        return json({ error: "refused", message: safeErrorMessage(e, secrets) }, 400);
      }
      throw Object.assign(new Error(safeErrorMessage(e, secrets)), { name: "OpsRouteError" });
    }
  });
}

export const Empty = z.object({}).strict();

/** Same protections for GET routes (read-only): login required, rate limited, never cached. */
export function opsGet(name: string, fn: (ctx: { url: URL; params: Record<string, string> }) => Promise<unknown>) {
  return guard(`ops/${name}`, async (req: Request, routeCtx?: RouteCtx) => {
    const auth = requireOps(req);
    if (!auth.ok) return auth.res;
    const rl = rateLimit(`opsget:${name}:${auth.session.sub}`, 240, 60_000);
    if (!rl.ok) return tooMany(rl.retryAfter);
    return json(await fn({ url: new URL(req.url), params: (await routeCtx?.params) ?? {} }));
  });
}
