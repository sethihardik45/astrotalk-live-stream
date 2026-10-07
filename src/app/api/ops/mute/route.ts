import { z } from "zod";
import { opsPost } from "@/lib/opsRoute";
import { setMuteOnAir } from "@/lib/stageControl";

export const dynamic = "force-dynamic";

export const POST = opsPost("mute", z.object({ on: z.boolean().optional() }), async ({ body }) => ({ muted: await setMuteOnAir(body.on) }));
