import { z } from "zod";
import { json, guard, readBody, tooMany } from "@/lib/http";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { loadAstrologerContext } from "@/lib/astrologerContext";
import { saveHeartbeat } from "@/lib/heartbeats";

export const dynamic = "force-dynamic";

const num = z.number().finite().nullable();
const Body = z.object({
  slug: z.string().min(1).max(100),
  phase: z.string().max(20),
  quality: z.string().max(20),
  rttMs: num,
  uplinkKbps: num,
  fps: num,
  width: num,
  height: num,
  limitation: z.string().max(40).nullable(),
  connection: z.string().max(30),
  publishing: z.boolean(),
});

/** POST /api/live/heartbeat — the astrologer page reports its connection health every 5 s. Shown on the ops diagnostics panel. */
export const POST = guard("live/heartbeat", async (req: Request) => {
  const ip = rateLimit(`hb:ip:${clientIp(req)}`, 60, 60_000);
  if (!ip.ok) return tooMany(ip.retryAfter);
  const body = await readBody(req, Body, 4_000);
  if (!body.ok) return body.res;
  const slugRl = rateLimit(`hb:slug:${body.data.slug.slice(0, 64)}`, 30, 60_000);
  if (!slugRl.ok) return tooMany(slugRl.retryAfter);

  const ctx = await loadAstrologerContext(body.data.slug);
  if (!ctx) return json({ error: "invalid_link" }, 404);

  const { slug: _slug, ...rest } = body.data;
  void _slug;
  saveHeartbeat({ astrologerId: ctx.astrologer.id, at: Date.now(), ...rest });
  return json({ ok: true });
});
