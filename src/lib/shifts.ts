import { db } from "./db";
import { findConflict, validateShiftTimes } from "./schedule/overlap";
import { expandTemplates } from "./schedule/templates";
import { formatDateTimeIst, istDateKey } from "./time";

/**
 * Database operations for shifts. The overlap rule is enforced TWICE:
 *   1. here in code, so ops get a friendly message that names the clash;
 *   2. by a Postgres exclusion constraint ("Shift_no_overlap"), so even a bug or a race cannot double-book the stage.
 */

export class ShiftError extends Error {}

function isOverlapConstraintError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : "";
  return msg.includes("Shift_no_overlap") || msg.includes("exclusion constraint");
}

async function assertNoConflict(startsAt: Date, endsAt: Date, ignoreId?: string) {
  const nearby = await db.shift.findMany({
    where: {
      // anything that could possibly touch [startsAt, endsAt)
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
    },
    include: { astrologer: { select: { name: true } } },
  });
  const clash = findConflict({ startsAt, endsAt }, nearby, ignoreId);
  if (clash) {
    const who = nearby.find((n) => n.id === clash.id)?.astrologer.name ?? "someone";
    throw new ShiftError(
      `This overlaps ${who}'s shift (${formatDateTimeIst(clash.startsAt)} to ${formatDateTimeIst(clash.endsAt)}). Only one astrologer can be on stage at a time.`,
    );
  }
}

export async function createShift(input: {
  astrologerId: string;
  startsAt: Date;
  endsAt: Date;
  templateId?: string;
  templateDate?: string;
}) {
  const bad = validateShiftTimes(input);
  if (bad) throw new ShiftError(bad);
  const astro = await db.astrologer.findUnique({ where: { id: input.astrologerId } });
  if (!astro) throw new ShiftError("That astrologer does not exist.");
  await assertNoConflict(input.startsAt, input.endsAt);
  try {
    return await db.shift.create({ data: input });
  } catch (e) {
    if (isOverlapConstraintError(e)) throw new ShiftError("This overlaps another shift.");
    throw e;
  }
}

export async function updateShift(id: string, input: { astrologerId?: string; startsAt?: Date; endsAt?: Date }) {
  const current = await db.shift.findUnique({ where: { id } });
  if (!current) throw new ShiftError("That shift no longer exists.");
  const startsAt = input.startsAt ?? current.startsAt;
  const endsAt = input.endsAt ?? current.endsAt;
  const bad = validateShiftTimes({ startsAt, endsAt });
  if (bad) throw new ShiftError(bad);
  await assertNoConflict(startsAt, endsAt, id);
  try {
    return await db.shift.update({ where: { id }, data: { astrologerId: input.astrologerId, startsAt, endsAt } });
  } catch (e) {
    if (isOverlapConstraintError(e)) throw new ShiftError("This overlaps another shift.");
    throw e;
  }
}

/** Delete a shift. If it came from a template we remember that, so the expander does not recreate it. */
export async function deleteShift(id: string) {
  const s = await db.shift.findUnique({ where: { id } });
  if (!s) return;
  await db.$transaction(async (tx) => {
    if (s.templateId && s.templateDate) {
      await tx.templateException.upsert({
        where: { templateId_date: { templateId: s.templateId, date: s.templateDate } },
        update: {},
        create: { templateId: s.templateId, date: s.templateDate },
      });
    }
    await tx.shift.delete({ where: { id } });
  });
}

/**
 * Expand all enabled templates into real shifts for the next `days` days (default 14). Safe to run any time, as often as you like.
 * Returns how many shifts were created and how many were skipped because they would overlap.
 */
export async function expandTemplatesToDb(days = 14, now = new Date()) {
  const fromDate = istDateKey(now);
  const [templates, existing, exceptions] = await Promise.all([
    db.shiftTemplate.findMany({ where: { enabled: true, astrologer: { active: true } } }),
    db.shift.findMany({ where: { endsAt: { gt: new Date(now.getTime() - 24 * 3_600_000) } } }),
    db.templateException.findMany(),
  ]);
  const result = expandTemplates({
    templates,
    fromDate,
    days,
    existing,
    exceptions: new Set(exceptions.map((e) => `${e.templateId}|${e.date}`)),
  });
  let created = 0;
  for (const c of result.create) {
    try {
      await db.shift.create({ data: c });
      created++;
    } catch (e) {
      if (!isOverlapConstraintError(e) && !(e instanceof Error && e.message.includes("Unique constraint"))) throw e;
    }
  }
  return { created, skippedOverlap: result.skipped.filter((s) => s.reason === "overlaps").length };
}
