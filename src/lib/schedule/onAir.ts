import { type ShiftLike, MS_MIN } from "./types";

/**
 * "Who should be on air at time T?" — pure functions, no database, no clock.
 * Everything takes `now` as a parameter so it can be tested to the millisecond.
 *
 * Time model: a shift is the half-open interval [startsAt, endsAt).
 *   - At exactly startsAt the shift IS on air.
 *   - At exactly endsAt the shift is NOT on air (and a back-to-back next shift IS).
 * This is what makes hand-offs between consecutive astrologers gap-free and unambiguous.
 */

const byStart = (a: ShiftLike, b: ShiftLike) =>
  a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id);

/** True if `now` falls inside [startsAt, endsAt). */
export function isActive(s: ShiftLike, now: Date): boolean {
  return s.startsAt.getTime() <= now.getTime() && now.getTime() < s.endsAt.getTime();
}

export interface ScheduleView {
  /** The shift containing `now`, if any. */
  onAir: ShiftLike | null;
  /** The earliest shift that starts after `now`. */
  next: ShiftLike | null;
  /** Shifts that start after `now` but within the lead time (people who should be connecting). */
  greenRoom: ShiftLike[];
}

/**
 * Compute on-air / next / green-room.
 * If data ever contains overlapping shifts (the database forbids it, but be defensive) the one that
 * started EARLIEST wins, ties broken by id, so the answer is deterministic.
 */
export function computeSchedule(shifts: ShiftLike[], now: Date, leadMs: number): ScheduleView {
  const sorted = [...shifts].sort(byStart);
  const t = now.getTime();

  const onAir = sorted.find((s) => isActive(s, now)) ?? null;
  const upcoming = sorted.filter((s) => s.startsAt.getTime() > t);
  const next = upcoming[0] ?? null;
  const greenRoom = upcoming.filter((s) => s.startsAt.getTime() - t <= leadMs);

  return { onAir, next, greenRoom };
}

// ---------------------------------------------------------------------------------------------
// Per-astrologer status (drives the /live/[slug] page and the token API)
// ---------------------------------------------------------------------------------------------

export type AstrologerPhase = "none" | "waiting" | "greenroom" | "onair" | "over";

export interface AstrologerStatus {
  phase: AstrologerPhase;
  /** The shift this status is about (current, upcoming, or the one that just ended). */
  shift: ShiftLike | null;
  /** The next shift AFTER the one in `shift` (shown in "over" and "none" states). */
  nextShift: ShiftLike | null;
}

/** How long after a shift ends we keep showing "Thank you, your shift is over". */
export const OVER_WINDOW_MS = 30 * MS_MIN;

/**
 * @param myShifts all shifts belonging to ONE astrologer
 * @param leadMs   how long before the start the green room opens
 */
export function astrologerStatus(
  myShifts: ShiftLike[],
  now: Date,
  leadMs: number,
  overWindowMs = OVER_WINDOW_MS,
): AstrologerStatus {
  const sorted = [...myShifts].sort(byStart);
  const t = now.getTime();

  const active = sorted.find((s) => isActive(s, now));
  if (active) {
    return { phase: "onair", shift: active, nextShift: sorted.find((s) => s.startsAt.getTime() >= active.endsAt.getTime()) ?? null };
  }

  const upcoming = sorted.filter((s) => s.startsAt.getTime() > t);
  const nextUp = upcoming[0] ?? null;

  if (nextUp && nextUp.startsAt.getTime() - t <= leadMs) {
    return { phase: "greenroom", shift: nextUp, nextShift: upcoming[1] ?? null };
  }

  const justEnded = [...sorted].reverse().find((s) => s.endsAt.getTime() <= t && t - s.endsAt.getTime() < overWindowMs);
  if (justEnded) {
    return { phase: "over", shift: justEnded, nextShift: nextUp };
  }

  if (nextUp) return { phase: "waiting", shift: nextUp, nextShift: upcoming[1] ?? null };
  return { phase: "none", shift: null, nextShift: null };
}

/**
 * The end of a run of back-to-back shifts that starts with `shift` (end of A == start of B == ...).
 * Used so an astrologer who has two consecutive slots keeps ONE valid token and is not kicked between them.
 */
export function chainEnd(myShifts: ShiftLike[], shift: ShiftLike): Date {
  const sorted = [...myShifts].sort(byStart);
  let end = shift.endsAt;
  for (const s of sorted) {
    if (s.startsAt.getTime() === end.getTime()) end = s.endsAt;
  }
  return end;
}
