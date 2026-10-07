import { z } from "zod";
import { opsPost, Empty } from "@/lib/opsRoute";
import { deleteShift, updateShift } from "@/lib/shifts";

export const dynamic = "force-dynamic";

const Patch = z.object({ astrologerId: z.string().min(1).max(50).optional(), startsAt: z.coerce.date().optional(), endsAt: z.coerce.date().optional() });

export const PATCH = opsPost("shifts/update", Patch, async ({ body, params }) => {
  await updateShift(params.id, body);
});

export const DELETE = opsPost("shifts/delete", Empty.or(z.object({}).passthrough()), async ({ params }) => {
  await deleteShift(params.id);
});
