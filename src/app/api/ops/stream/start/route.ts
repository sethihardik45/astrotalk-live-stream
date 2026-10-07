import { z } from "zod";
import { describeSession, PLATFORMS, startStream } from "@/lib/egressControl";
import { opsPost } from "@/lib/opsRoute";

export const dynamic = "force-dynamic";

// The stream key is accepted here, used once to start the egress, and never stored, logged or returned.
const Body = z.object({
  serverUrl: z.string().trim().min(8).max(500),
  streamKey: z.string().trim().min(1).max(3000),
  label: z.string().trim().max(60).optional(),
  platform: z.enum(PLATFORMS).default("instagram"),
});

export const POST = opsPost("stream/start", Body, async ({ body, ip }) => {
  const s = await startStream({ ...body, ip });
  return { session: describeSession(s) };
});
