import { z } from "zod";
import { json, guard, readBody, tooMany } from "@/lib/http";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { loadAstrologerContext, chainEnd } from "@/lib/astrologerContext";
import { mintAstrologerToken } from "@/lib/livekit";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

const Body = z.object({ slug: z.string().min(1).max(100) });

const TOKEN_BUFFER_SECONDS = 10 * 60;

/**
 * POST /api/live/token  { slug }
 * Hands an astrologer a LiveKit token — but ONLY inside their allowed window:
 * from (shift start - green room lead time) until shift end. Outside it: 403.
 *
 * The token can join the room but cannot publish video/audio. Publishing is granted later, by the worker, at shift start.
 */
export const POST = guard("live/token", async (req: Request) => {
  const ip = clientIp(req);
  const ipLimit = rateLimit(`token:ip:${ip}`, 30, 60_000);
  if (!ipLimit.ok) return tooMany(ipLimit.retryAfter);

  const body = await readBody(req, Body);
  if (!body.ok) return body.res;

  const slugLimit = rateLimit(`token:slug:${body.data.slug.slice(0, 64)}`, 20, 60_000);
  if (!slugLimit.ok) return tooMany(slugLimit.retryAfter);

  const now = new Date();
  const ctx = await loadAstrologerContext(body.data.slug, now);
  if (!ctx) return json({ error: "invalid_link" }, 404);

  const { phase, shift } = ctx.status;
  if ((phase !== "greenroom" && phase !== "onair") || !shift) {
    return json({ error: "outside_window", phase }, 403);
  }

  // Valid until the end of this shift (or run of back-to-back shifts) plus a buffer for the hand-off.
  const end = chainEnd(ctx.shifts, shift);
  const ttlSeconds = Math.max(120, Math.ceil((end.getTime() - now.getTime()) / 1000) + TOKEN_BUFFER_SECONDS);

  const token = await mintAstrologerToken({ identity: ctx.astrologer.id, name: ctx.astrologer.name, ttlSeconds });
  return json({ token, url: env().NEXT_PUBLIC_LIVEKIT_URL, identity: ctx.astrologer.id, expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString() });
});
