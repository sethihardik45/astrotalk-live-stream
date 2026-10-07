import { z } from "zod";
import { createSessionCookieValue, isSecureRequest, sameOrigin, SESSION_HOURS, sessionCookieHeader, verifyLogin } from "@/lib/auth";
import { guard, json, readBody, tooMany } from "@/lib/http";
import { clientIp, isLimited, rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

const Body = z.object({ password: z.string().min(1).max(200) });

/** POST /api/ops/login { password } — sets the signed session cookie. Rate limited: 8 WRONG tries per 10 minutes per address. */
export const POST = guard("ops/login", async (req: Request) => {
  if (!sameOrigin(req)) return json({ error: "bad_origin" }, 403);
  const ip = clientIp(req);
  // Only WRONG passwords count towards the lockout, so successful logins by the team can never lock anyone out.
  const perIp = isLimited(`login:ip:${ip}`, 8);
  const global = isLimited("login:all", 60); // stops a botnet that rotates addresses
  if (!perIp.ok || !global.ok) return tooMany(Math.max(perIp.retryAfter, global.retryAfter));

  const body = await readBody(req, Body, 1000);
  if (!body.ok) return body.res;

  const session = verifyLogin(body.data.password);
  if (!session) {
    rateLimit(`login:ip:${ip}`, 8, 10 * 60_000);
    rateLimit("login:all", 60, 10 * 60_000);
    return json({ error: "wrong_password" }, 401);
  }

  return json({ ok: true }, 200, {
    "Set-Cookie": sessionCookieHeader(createSessionCookieValue(session), SESSION_HOURS * 3600, isSecureRequest(req)),
  });
});
