import { db } from "./db";
import { env } from "./env";
import { logEvent } from "./events";
import { roomName, roomService } from "./livekit";
import { planImport, type ImportPlan } from "./csvImport";
import { computeCoverage, findOverlaps } from "./schedule/overlap";
import { ShiftError, createShift, expandTemplatesToDb } from "./shifts";
import { generateSlug } from "./slug";
import { parseHHmm } from "./time";

/** Database operations behind the schedule admin screens (astrologers, templates, the weekly view, CSV import). */

export const linkFor = (slug: string) => `${env().NEXT_PUBLIC_APP_URL.replace(/\/+$/, "")}/live/${slug}`;

// ---------------------------------------------------------------- astrologers

export async function createAstrologer(input: { name: string; tagline?: string | null; photoUrl?: string | null }) {
  const name = input.name.trim().replace(/\s+/g, " ");
  const dup = (await db.astrologer.findMany({ select: { name: true } })).find((a) => a.name.toLowerCase() === name.toLowerCase());
  if (dup) throw new ShiftError(`There is already an astrologer called “${dup.name}”.`);
  const a = await db.astrologer.create({ data: { name, tagline: input.tagline || null, photoUrl: input.photoUrl || null, slug: generateSlug() } });
  await logEvent("schedule", `Astrologer added: ${a.name}`);
  return a;
}

async function mustExist(id: string) {
  if (!(await db.astrologer.findUnique({ where: { id }, select: { id: true } }))) throw new ShiftError("That astrologer no longer exists. Please reload the page.");
}

export async function updateAstrologer(id: string, input: { name?: string; tagline?: string | null; photoUrl?: string | null; active?: boolean }) {
  await mustExist(id);
  const a = await db.astrologer.update({
    where: { id },
    data: { name: input.name?.trim().replace(/\s+/g, " "), tagline: input.tagline, photoUrl: input.photoUrl, active: input.active },
  });
  if (input.active !== undefined) await logEvent("schedule", `${a.name} was ${input.active ? "switched on" : "switched off"}`);
  return a;
}

/**
 * Give an astrologer a brand-new secret link. The old link stops working at once (the slug it contains no longer exists),
 * and if they are connected right now we also disconnect them and cancel their old LiveKit passes.
 */
export async function regenerateSlug(id: string) {
  await mustExist(id);
  const a = await db.astrologer.update({ where: { id }, data: { slug: generateSlug() } });
  await logEvent("schedule", `New link created for ${a.name}; the old link no longer works`);
  try {
    await roomService().removeParticipant(roomName(), a.id, { revokeTokenTs: BigInt(Math.floor(Date.now() / 1000)) });
  } catch {
    /* not connected, or LiveKit unreachable: the old link is already dead for new visits */
  }
  return a;
}

// ---------------------------------------------------------------- templates

export interface TemplateInput {
  astrologerId: string;
  startTimeLocal: string;
  durationMinutes: number;
  daysOfWeek: number[];
  enabled?: boolean;
}

function checkTemplate(t: Partial<TemplateInput>) {
  if (t.startTimeLocal !== undefined) {
    try {
      parseHHmm(t.startTimeLocal);
    } catch {
      throw new ShiftError("The start time must look like 14:00.");
    }
  }
  if (t.durationMinutes !== undefined && (t.durationMinutes < 15 || t.durationMinutes > 720)) throw new ShiftError("The length must be between 15 minutes and 12 hours.");
  if (t.daysOfWeek !== undefined && (t.daysOfWeek.length === 0 || t.daysOfWeek.some((d) => d < 0 || d > 6))) throw new ShiftError("Choose at least one day of the week.");
}

export async function createTemplate(input: TemplateInput) {
  checkTemplate(input);
  if (!(await db.astrologer.findUnique({ where: { id: input.astrologerId } }))) throw new ShiftError("That astrologer does not exist.");
  const t = await db.shiftTemplate.create({ data: { ...input, daysOfWeek: [...new Set(input.daysOfWeek)].sort(), enabled: input.enabled ?? true } });
  const r = await expandTemplatesToDb(14);
  await logEvent("schedule", `Recurring slot added; ${r.created} shifts created${r.skippedOverlap ? `, ${r.skippedOverlap} skipped (would overlap)` : ""}`);
  return { template: t, ...r };
}

export async function updateTemplate(id: string, input: Partial<TemplateInput>) {
  checkTemplate(input);
  const t = await db.shiftTemplate.update({ where: { id }, data: { ...input, daysOfWeek: input.daysOfWeek ? [...new Set(input.daysOfWeek)].sort() : undefined } });
  const r = await expandTemplatesToDb(14);
  return { template: t, ...r };
}

/** Delete a template. With `deleteFutureShifts`, also delete the shifts it generated that have not started yet. */
export async function deleteTemplate(id: string, deleteFutureShifts: boolean) {
  let removed = 0;
  if (deleteFutureShifts) removed = (await db.shift.deleteMany({ where: { templateId: id, startsAt: { gt: new Date() } } })).count;
  await db.shiftTemplate.delete({ where: { id } });
  await logEvent("schedule", `Recurring slot deleted${removed ? ` (${removed} future shifts removed)` : ""}`);
  return { removed };
}

// ---------------------------------------------------------------- the weekly view

export async function scheduleSnapshot(from: Date, days: number) {
  const to = new Date(from.getTime() + days * 86_400_000);
  const now = new Date();
  const next7 = new Date(now.getTime() + 7 * 86_400_000);

  const [astrologers, templates, shifts, shiftsNext7] = await Promise.all([
    db.astrologer.findMany({ orderBy: { createdAt: "asc" } }),
    db.shiftTemplate.findMany({ orderBy: [{ startTimeLocal: "asc" }] }),
    db.shift.findMany({ where: { startsAt: { lt: to }, endsAt: { gt: from } }, orderBy: { startsAt: "asc" } }),
    db.shift.findMany({ where: { startsAt: { lt: next7 }, endsAt: { gt: now } } }),
  ]);
  const nameOf = new Map(astrologers.map((a) => [a.id, a.name]));
  // Only ACTIVE astrologers count as coverage: someone switched off cannot go on air.
  const activeIds = new Set(astrologers.filter((a) => a.active).map((a) => a.id));

  const coverage7 = computeCoverage(shiftsNext7.filter((s) => activeIds.has(s.astrologerId)), now, next7);
  // Gaps in the PAST cannot be fixed, so they are not flagged: only look from "now" onwards.
  const rangeCoverage = computeCoverage(shifts.filter((s) => activeIds.has(s.astrologerId)), from.getTime() < now.getTime() ? now : from, to);

  return {
    serverNow: now.toISOString(),
    from: from.toISOString(),
    to: to.toISOString(),
    appUrl: env().NEXT_PUBLIC_APP_URL,
    astrologers: astrologers.map((a) => ({ id: a.id, name: a.name, tagline: a.tagline, photoUrl: a.photoUrl, active: a.active, link: linkFor(a.slug) })),
    templates: templates.map((t) => ({ id: t.id, astrologerId: t.astrologerId, name: nameOf.get(t.astrologerId) ?? "?", startTimeLocal: t.startTimeLocal, durationMinutes: t.durationMinutes, daysOfWeek: t.daysOfWeek, enabled: t.enabled })),
    shifts: shifts.map((s) => ({ id: s.id, astrologerId: s.astrologerId, name: nameOf.get(s.astrologerId) ?? "?", active: activeIds.has(s.astrologerId), startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString(), fromTemplate: !!s.templateId })),
    gaps: rangeCoverage.gaps.map((g) => ({ startsAt: g.startsAt.toISOString(), endsAt: g.endsAt.toISOString() })),
    overlaps: findOverlaps(shifts).map(([a, b]) => [a.id, b.id]),
    coverageNext7Days: { percent: coverage7.percent, gapCount: coverage7.gaps.length },
  };
}

// ---------------------------------------------------------------- CSV import

export async function importCsv(csv: string, commit: boolean) {
  const [astrologers, existingShifts] = await Promise.all([db.astrologer.findMany({ select: { id: true, name: true, active: true } }), db.shift.findMany({ select: { startsAt: true, endsAt: true } })]);
  const plan: ImportPlan = planImport({ csv, astrologers, existingShifts });
  const summary = {
    rows: plan.rowCount,
    astrologersToCreate: plan.astrologersToCreate.map((a) => a.name),
    shiftsToCreate: plan.shiftsToCreate.length,
    errors: plan.errors,
  };
  if (!commit) return { committed: false, ...summary };

  const idByKey = new Map(astrologers.map((a) => [a.name.trim().replace(/\s+/g, " ").toLowerCase(), a.id]));
  for (const a of plan.astrologersToCreate) {
    const created = await db.astrologer.create({ data: { name: a.name, tagline: a.tagline, photoUrl: a.photoUrl, slug: generateSlug() } });
    idByKey.set(a.key, created.id);
  }
  let created = 0;
  const failed: Array<{ line: number; message: string }> = [];
  for (const s of plan.shiftsToCreate) {
    try {
      await createShift({ astrologerId: idByKey.get(s.astrologerKey)!, startsAt: s.startsAt, endsAt: s.endsAt });
      created++;
    } catch (e) {
      failed.push({ line: s.line, message: e instanceof Error ? e.message : "Could not create this shift." });
    }
  }
  await logEvent("schedule", `CSV import: ${plan.astrologersToCreate.length} astrologers and ${created} shifts added`);
  return { committed: true, ...summary, shiftsCreated: created, errors: [...plan.errors, ...failed] };
}
