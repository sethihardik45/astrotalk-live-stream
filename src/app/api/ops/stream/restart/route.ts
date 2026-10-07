import { z } from "zod";
import { describeSession, restartFailed } from "@/lib/egressControl";
import { opsPost } from "@/lib/opsRoute";

export const dynamic = "force-dynamic";

export const POST = opsPost("stream/restart", z.object({ sessionId: z.string().min(1).max(50) }), async ({ body, ip }) => {
  const s = await restartFailed(body.sessionId, ip);
  return { session: describeSession(s) };
});
