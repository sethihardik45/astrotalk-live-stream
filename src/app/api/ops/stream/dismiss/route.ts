import { z } from "zod";
import { opsPost } from "@/lib/opsRoute";
import { setSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** Hide the red "stream stopped unexpectedly" alert for one stream (it stays in the event log). */
export const POST = opsPost("stream/dismiss", z.object({ sessionId: z.string().min(1).max(50) }), async ({ body }) => {
  await setSetting(`streamAlertDismissed:${body.sessionId}`, "1");
});
