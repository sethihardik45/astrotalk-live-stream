import { z } from "zod";
import { opsPost } from "@/lib/opsRoute";
import { createShift } from "@/lib/shifts";

export const dynamic = "force-dynamic";

const Body = z.object({ astrologerId: z.string().min(1).max(50), startsAt: z.coerce.date(), endsAt: z.coerce.date() });

export const POST = opsPost("shifts/create", Body, async ({ body }) => {
  const s = await createShift(body);
  return { id: s.id };
});
