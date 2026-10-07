import { json, guard, tooMany } from "@/lib/http";
import { clientIp, rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/** GET: tiny reply for measuring round-trip time. POST: swallow up to ~1 MB to measure upload speed (the pre-flight network check). */
export const GET = guard("live/ping", async (req: Request) => {
  const r = rateLimit(`ping:ip:${clientIp(req)}`, 120, 60_000);
  if (!r.ok) return tooMany(r.retryAfter);
  return json({ t: Date.now() });
});

export const POST = guard("live/ping-up", async (req: Request) => {
  const r = rateLimit(`pingup:ip:${clientIp(req)}`, 20, 60_000);
  if (!r.ok) return tooMany(r.retryAfter);
  const buf = await req.arrayBuffer();
  if (buf.byteLength > 1_100_000) return json({ error: "too_large" }, 413);
  return json({ received: buf.byteLength });
});
