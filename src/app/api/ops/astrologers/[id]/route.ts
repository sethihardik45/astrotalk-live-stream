import { z } from "zod";
import { updateAstrologer } from "@/lib/adminData";
import { opsPost } from "@/lib/opsRoute";

export const dynamic = "force-dynamic";

const Body = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  tagline: z.string().trim().max(120).nullish(),
  photoUrl: z.string().trim().regex(/^https:\/\/\S+$/, "Photo address must start with https://").max(500).nullish().or(z.literal("")),
  active: z.boolean().optional(),
});

export const PATCH = opsPost("astrologers/update", Body, async ({ body, params }) => {
  await updateAstrologer(params.id, { ...body, photoUrl: body.photoUrl === "" ? null : body.photoUrl });
});
