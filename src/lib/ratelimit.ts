/**
 * Tiny in-memory rate limiter (fixed window). Good enough for ONE web process, which is how we deploy.
 * If you ever run several web servers, move this to Redis.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const g = globalThis as unknown as { __rl?: Map<string, Bucket> };
const buckets = (g.__rl ??= new Map<string, Bucket>());

export interface RateResult {
  ok: boolean;
  /** seconds until the window resets (only meaningful when ok = false) */
  retryAfter: number;
}

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): RateResult {
  // opportunistic cleanup so the map cannot grow forever
  if (buckets.size > 5000) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }
  b.count++;
  if (b.count > limit) return { ok: false, retryAfter: Math.ceil((b.resetAt - now) / 1000) };
  return { ok: true, retryAfter: 0 };
}

/** Is this key already over its limit? (Does not count a new attempt.) */
export function isLimited(key: string, limit: number, now = Date.now()): RateResult {
  const b = buckets.get(key);
  if (!b || b.resetAt <= now || b.count < limit) return { ok: true, retryAfter: 0 };
  return { ok: false, retryAfter: Math.ceil((b.resetAt - now) / 1000) };
}

/** Test helper. */
export function resetRateLimits() {
  buckets.clear();
}

/**
 * The caller's IP. We run behind Caddy, which sets X-Forwarded-For to the real client address
 * (and discards any value the client tried to send). Do NOT expose the web container directly to the internet.
 */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim().slice(0, 64);
  return req.headers.get("x-real-ip")?.slice(0, 64) ?? "unknown";
}
