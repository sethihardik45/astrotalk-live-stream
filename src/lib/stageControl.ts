import { db } from "./db";
import { enforceOnce } from "./enforce";
import { logEvent } from "./events";
import { SETTING_KEYS, getBool, setSetting } from "./settings";
import { blockShift, getBlockedShiftIds } from "./stage";
import { computeSchedule } from "./schedule/onAir";

/**
 * The ops "stage" buttons. Each one changes a setting or a shift and then runs `enforceOnce` right away, so the effect is
 * instant instead of waiting up to 2 seconds for the worker's next pass.
 */
export class StageError extends Error {}

async function currentView() {
  const now = new Date();
  const [shifts, blocked] = await Promise.all([
    db.shift.findMany({ where: { endsAt: { gt: now }, startsAt: { lt: new Date(now.getTime() + 24 * 3_600_000) } }, include: { astrologer: true }, orderBy: { startsAt: "asc" } }),
    getBlockedShiftIds(),
  ]);
  const usable = shifts.filter((s) => !blocked.has(s.id) && s.astrologer.active);
  return { now, usable, view: computeSchedule(usable, now, 0) };
}

/** Show / hide the transition video on every running stream. `on` omitted = flip. */
export async function setTransition(on?: boolean) {
  const next = on ?? !(await getBool(SETTING_KEYS.transitionOn));
  await setSetting(SETTING_KEYS.transitionOn, String(next));
  await logEvent("control", next ? "Transition video switched ON by ops" : "Transition video switched OFF by ops");
  await enforceOnce();
  return next;
}

/** Silence the person currently on air (for this shift only). `on` omitted = flip. */
export async function setMuteOnAir(on?: boolean) {
  const { view } = await currentView();
  if (!view.onAir) throw new StageError("Nobody is on air right now.");
  const current = (await db.setting.findUnique({ where: { key: SETTING_KEYS.forceMute } }))?.value === view.onAir.id;
  const next = on ?? !current;
  await setSetting(SETTING_KEYS.forceMute, next ? view.onAir.id : "");
  const who = (await db.astrologer.findUnique({ where: { id: view.onAir.astrologerId } }))?.name ?? "the astrologer";
  await logEvent("control", next ? `${who} muted by ops` : `${who} unmuted by ops`);
  await enforceOnce();
  return next;
}

/** Take the current astrologer off the stage for the rest of THIS shift. They are disconnected and shown a message. */
export async function removeFromStage() {
  const { view } = await currentView();
  if (!view.onAir) throw new StageError("Nobody is on air right now.");
  await blockShift(view.onAir.id);
  const who = (await db.astrologer.findUnique({ where: { id: view.onAir.astrologerId } }))?.name ?? "The astrologer";
  await logEvent("control", `${who} was removed from the stage by ops`);
  await enforceOnce();
}

/**
 * End the current shift now and start the next one now. Implemented by editing the two shifts (so the schedule view stays
 * honest): current.endsAt = now, next.startsAt = now. Done in one transaction; the overlap rule stays satisfied.
 */
export async function skipToNext() {
  const { now, usable } = await currentView();
  const current = usable.find((s) => s.startsAt <= now && now < s.endsAt) ?? null;
  const next = usable.find((s) => s.startsAt > now) ?? null;
  if (!next) throw new StageError("There is no next astrologer scheduled.");
  try {
    await db.$transaction(async (tx) => {
      // The database forbids overlaps among ALL shifts, including ones that are removed from stage or belong to someone switched
      // off. So look at everything between now and the next start.
      const inTheWay = await tx.shift.findMany({ where: { id: { not: next.id }, startsAt: { lt: next.startsAt }, endsAt: { gt: now } } });
      for (const s of inTheWay) {
        if (s.startsAt <= now) await tx.shift.update({ where: { id: s.id }, data: { endsAt: now } }); // running now: end it now
        else throw new StageError("Another shift (for someone switched off or removed from stage) sits in between. Open the Schedule and delete or move it first.");
      }
      await tx.shift.update({ where: { id: next.id }, data: { startsAt: now } });
    });
  } catch (e) {
    if (e instanceof StageError) throw e;
    if (e instanceof Error && /Shift_no_overlap|exclusion constraint/.test(e.message)) throw new StageError("Could not skip: it would overlap another shift. Open the Schedule to check.");
    throw e;
  }
  await logEvent("control", `Skipped ahead: ${current ? current.astrologer.name + " ended early, " : ""}${next.astrologer.name} starts now`);
  await enforceOnce();
  return { next: next.astrologer.name };
}
