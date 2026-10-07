import { z } from "zod";
import { deleteTemplate, updateTemplate } from "@/lib/adminData";
import { opsPost } from "@/lib/opsRoute";

export const dynamic = "force-dynamic";

const Patch = z.object({
  astrologerId: z.string().min(1).max(50).optional(),
  startTimeLocal: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  durationMinutes: z.number().int().min(15).max(720).optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
  enabled: z.boolean().optional(),
});

export const PATCH = opsPost("templates/update", Patch, async ({ body, params }) => {
  const r = await updateTemplate(params.id, body);
  return { created: r.created };
});

export const DELETE = opsPost("templates/delete", z.object({ deleteFutureShifts: z.boolean().optional() }), async ({ body, params }) => deleteTemplate(params.id, !!body.deleteFutureShifts));
