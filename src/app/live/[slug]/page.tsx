import type { Metadata } from "next";
import { db } from "@/lib/db";
import { looksLikeSlug } from "@/lib/slug";
import { S } from "@/lib/strings";
import { LiveClient } from "@/components/live/LiveClient";

export const dynamic = "force-dynamic";

// Personal links are secrets: keep them out of search engines and never send them as a Referer to other sites.
export const metadata: Metadata = {
  title: "AstroTalk Live",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function LivePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  // Unknown OR inactive slug: the same generic page, with no hints about which one it was.
  const astro = looksLikeSlug(slug) ? await db.astrologer.findUnique({ where: { slug }, select: { active: true } }) : null;
  if (!astro || !astro.active) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-2xl font-bold">{S.invalid.title}</h1>
        <p className="text-[var(--muted)]">{S.invalid.body}</p>
      </main>
    );
  }

  return <LiveClient slug={slug} />;
}
