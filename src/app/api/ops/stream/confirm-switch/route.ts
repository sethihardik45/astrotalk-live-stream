import { z } from "zod";
import { confirmSwitch, describeSession, PLATFORMS } from "@/lib/egressControl";
import { opsPost } from "@/lib/opsRoute";

export const dynamic = "force-dynamic";

/** Stops the OLD stream of one platform once the new one is live there. */
export const POST = opsPost("stream/confirm-switch", z.object({ platform: z.enum(PLATFORMS).default("instagram") }), async ({ body }) => {
  const s = await confirmSwitch(body.platform);
  return { session: describeSession(s) };
});
