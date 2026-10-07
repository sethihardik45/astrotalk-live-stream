import { z } from "zod";
import { createTemplate } from "@/lib/adminData";
import { opsPost } from "@/lib/opsRoute";

export const dynamic = "force-dynamic";

export const TemplateBody = z.object({
  astrologerId: z.string().min(1).max(50),
  startTimeLocal: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm, e.g. 14:00"),
  durationMinutes: z.number().int().min(15).max(720),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  enabled: z.boolean().optional(),
});

export const POST = opsPost("templates/create", TemplateBody, async ({ body }) => {
  const r = await createTemplate(body);
  return { created: r.created, skippedOverlap: r.skippedOverlap };
});
