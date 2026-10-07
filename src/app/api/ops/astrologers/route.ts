import { z } from "zod";
import { createAstrologer, linkFor } from "@/lib/adminData";
import { opsPost } from "@/lib/opsRoute";

export const dynamic = "force-dynamic";

const Body = z.object({
  name: z.string().trim().min(1).max(80),
  tagline: z.string().trim().max(120).nullish(),
  photoUrl: z.string().trim().regex(/^https:\/\/\S+$/, "Photo address must start with https://").max(500).nullish().or(z.literal("")),
});

export const POST = opsPost("astrologers/create", Body, async ({ body }) => {
  const a = await createAstrologer(body);
  return { id: a.id, link: linkFor(a.slug) };
});
