import { z } from "zod";
import { describeSession, rotateStream } from "@/lib/egressControl";
import { opsPost } from "@/lib/opsRoute";

export const dynamic = "force-dynamic";

const Body = z.object({
  serverUrl: z.string().trim().min(8).max(500),
  streamKey: z.string().trim().min(1).max(3000),
  label: z.string().trim().max(60).optional(),
});

export const POST = opsPost("stream/rotate", Body, async ({ body, ip }) => {
  const s = await rotateStream({ ...body, ip });
  return { session: describeSession(s) };
});
