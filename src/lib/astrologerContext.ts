import { db } from "./db";
import { looksLikeSlug } from "./slug";
import { loadSettings } from "./settings";
import { getBlockedShiftIds } from "./stage";
import { astrologerStatus, chainEnd, type AstrologerStatus } from "./schedule/onAir";
import type { ShiftLike } from "./schedule/types";

export interface AstrologerContext {
  astrologer: { id: string; name: string; tagline: string | null; photoUrl: string | null };
  /** Their shifts that are not over yet (plus recently ended ones), blocked ones removed. */
  shifts: ShiftLike[];
  /** True if ops removed them from the stage for their current / imminent shift. */
  removedByOps: boolean;
  leadMs: number;
  warnMinutes: number[];
  status: AstrologerStatus;
}

/**
 * Everything the token and state endpoints need, from a slug. Returns null for an unknown OR inactive slug
 * (callers must answer both identically so nobody can probe which links exist).
 */
export async function loadAstrologerContext(slug: unknown, now = new Date()): Promise<AstrologerContext | null> {
  if (!looksLikeSlug(slug)) return null;
  const astro = await db.astrologer.findUnique({ where: { slug } });
  if (!astro || !astro.active) return null;

  const [settings, blocked, shifts] = await Promise.all([
    loadSettings(),
    getBlockedShiftIds(),
    db.shift.findMany({
      where: { astrologerId: astro.id, endsAt: { gt: new Date(now.getTime() - 60 * 60_000) } },
      orderBy: { startsAt: "asc" },
      take: 12,
    }),
  ]);

  const visible = shifts.filter((s) => !blocked.has(s.id));
  const statusWithBlocked = astrologerStatus(shifts, now, settings.leadMs);
  const removedByOps =
    (statusWithBlocked.phase === "onair" || statusWithBlocked.phase === "greenroom") &&
    !!statusWithBlocked.shift &&
    blocked.has(statusWithBlocked.shift.id);

  return {
    astrologer: { id: astro.id, name: astro.name, tagline: astro.tagline, photoUrl: astro.photoUrl },
    shifts: visible,
    removedByOps,
    leadMs: settings.leadMs,
    warnMinutes: settings.warnMinutes,
    status: astrologerStatus(visible, now, settings.leadMs),
  };
}

export { chainEnd };
