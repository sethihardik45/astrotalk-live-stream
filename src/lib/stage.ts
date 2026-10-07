import { db } from "./db";

/**
 * "Remove astrologer from stage" is remembered per SHIFT, as a setting named "blockedShift:<shiftId>".
 * A blocked shift is treated as if it did not exist: no token, no publish permission, and the layout shows the
 * transition video until the shift would have ended. The astrologer's next shifts are unaffected.
 */
const PREFIX = "blockedShift:";

export async function getBlockedShiftIds(): Promise<Set<string>> {
  const rows = await db.setting.findMany({ where: { key: { startsWith: PREFIX } } });
  return new Set(rows.map((r) => r.key.slice(PREFIX.length)));
}

export async function blockShift(shiftId: string): Promise<void> {
  await db.setting.upsert({ where: { key: PREFIX + shiftId }, update: { value: "1" }, create: { key: PREFIX + shiftId, value: "1" } });
}

/** Housekeeping: forget blocks for shifts that ended more than a day ago (or were deleted). */
export async function pruneBlockedShifts(now = new Date()): Promise<void> {
  const blocked = await getBlockedShiftIds();
  if (blocked.size === 0) return;
  const recent = await db.shift.findMany({
    where: { id: { in: [...blocked] }, endsAt: { gte: new Date(now.getTime() - 86_400_000) } },
    select: { id: true },
  });
  const keep = new Set(recent.map((r) => r.id));
  const stale = [...blocked].filter((id) => !keep.has(id));
  if (stale.length) await db.setting.deleteMany({ where: { key: { in: stale.map((id) => PREFIX + id) } } });
}
