import { z } from "zod";
import { opsPost } from "@/lib/opsRoute";
import { setTransition } from "@/lib/stageControl";

export const dynamic = "force-dynamic";

/** Body { on: true|false } sets it; empty body flips it. */
export const POST = opsPost("transition", z.object({ on: z.boolean().optional() }), async ({ body }) => ({ transitionOn: await setTransition(body.on) }));
