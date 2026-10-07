import { isSecureRequest, sameOrigin, sessionCookieHeader } from "@/lib/auth";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "bad_origin" }, 403);
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookieHeader("", 0, isSecureRequest(req)) });
}
