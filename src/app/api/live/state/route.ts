import { z } from "zod";
import { json, guard, readBody, tooMany } from "@/lib/http";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { loadAstrologerContext } from "@/lib/astrologerContext";

export const dynamic = "force-dynamic";

const Body = z.object({ slug: z.string().min(1).max(100) });

/**
 * POST /api/live/state  { slug }   (POST, not GET, so the secret slug never appears in a URL, access log or browser history)
 * Tells the astrologer page where it stands. The page ALSO reacts instantly to LiveKit events; this is the
 * slow, reliable source for countdowns, clock offset and the list of upcoming shifts.
 *
 * We send raw shift times plus the server clock; the browser recomputes the phase every second with the same
 * pure function the server uses, so countdowns and phase changes don't wait for the next poll.
 */
export const POST = guard("live/state", async (req: Request) => {
  const ip = clientIp(req);
  const ipLimit = rateLimit(`state:ip:${ip}`, 60, 60_000);
  if (!ipLimit.ok) return tooMany(ipLimit.retryAfter);

  const body = await readBody(req, Body, 1000);
  if (!body.ok) return body.res;
  const slugLimit = rateLimit(`state:slug:${body.data.slug.slice(0, 64)}`, 40, 60_000);
  if (!slugLimit.ok) return tooMany(slugLimit.retryAfter);

  const now = new Date();
  const ctx = await loadAstrologerContext(body.data.slug, now);
  if (!ctx) return json({ error: "invalid_link" }, 404);

  return json({
    serverNow: now.toISOString(),
    astrologer: { name: ctx.astrologer.name, tagline: ctx.astrologer.tagline, photoUrl: ctx.astrologer.photoUrl },
    phase: ctx.status.phase,
    shift: ctx.status.shift && { startsAt: ctx.status.shift.startsAt.toISOString(), endsAt: ctx.status.shift.endsAt.toISOString() },
    shifts: ctx.shifts.map((s) => ({ id: s.id, startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString() })),
    removedByOps: ctx.removedByOps,
    leadMinutes: Math.round(ctx.leadMs / 60_000),
    warnMinutes: ctx.warnMinutes,
  });
});
