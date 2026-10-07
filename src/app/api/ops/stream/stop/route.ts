import { z } from "zod";
import { stopStreams } from "@/lib/egressControl";
import { opsPost } from "@/lib/opsRoute";

export const dynamic = "force-dynamic";

/** Body { sessionId } stops one stream; empty body stops all of them. The UI asks "are you sure?" first. */
export const POST = opsPost("stream/stop", z.object({ sessionId: z.string().max(50).optional() }), async ({ body }) => {
  await stopStreams(body.sessionId);
});
