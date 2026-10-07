import { linkFor, regenerateSlug } from "@/lib/adminData";
import { Empty, opsPost } from "@/lib/opsRoute";

export const dynamic = "force-dynamic";

/** Gives the astrologer a new secret link; the old one stops working immediately. */
export const POST = opsPost("astrologers/regenerate", Empty, async ({ params }) => {
  const a = await regenerateSlug(params.id);
  return { link: linkFor(a.slug) };
});
