import { type ShiftLike, MS_MIN } from "./types";

/** Longest single shift we accept (sanity check against typos like a 3-day shift). */
export const MAX_SHIFT_MINUTES = 12 * 60;

export interface Interval {
  startsAt: Date;
  endsAt: Date;
}

/** Two half-open intervals [a.start, a.end) and [b.start, b.end) overlap iff each starts before the other ends. */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.startsAt.getTime() < b.endsAt.getTime() && b.startsAt.getTime() < a.endsAt.getTime();
}

/** Returns a human-readable problem with the shift's own times, or null if fine. */
export function validateShiftTimes(i: Interval): string | null {
  const s = i.startsAt.getTime();
  const e = i.endsAt.getTime();
  if (Number.isNaN(s) || Number.isNaN(e)) return "The start or end time is not a valid date.";
  if (e <= s) return "The shift must end after it starts.";
  if ((e - s) / MS_MIN > MAX_SHIFT_MINUTES) return `A shift cannot be longer than ${MAX_SHIFT_MINUTES / 60} hours.`;
  return null;
}

/**
 * The first existing shift that collides with `candidate`, or null.
 * `ignoreId` lets you move/edit a shift without it colliding with its own old position.
 */
export function findConflict<T extends ShiftLike>(candidate: Interval, existing: T[], ignoreId?: string): T | null {
  return existing.find((s) => s.id !== ignoreId && overlaps(candidate, s)) ?? null;
}

/** All pairs of shifts in a list that overlap (used to flag problems in imported data and in the grid). */
export function findOverlaps<T extends ShiftLike>(shifts: T[]): Array<[T, T]> {
  const sorted = [...shifts].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const pairs: Array<[T, T]> = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[j].startsAt.getTime() >= sorted[i].endsAt.getTime()) break;
      pairs.push([sorted[i], sorted[j]]);
    }
  }
  return pairs;
}

export interface Coverage {
  coveredMs: number;
  totalMs: number;
  /** 0-100, one decimal. */
  percent: number;
  gaps: Interval[];
}

/** How much of [from, to) is covered by at least one shift, plus the list of gaps. Overlaps are not double-counted. */
export function computeCoverage(shifts: Interval[], from: Date, to: Date): Coverage {
  const f = from.getTime();
  const t = to.getTime();
  const clipped = shifts
    .map((s) => ({ s: Math.max(s.startsAt.getTime(), f), e: Math.min(s.endsAt.getTime(), t) }))
    .filter((x) => x.e > x.s)
    .sort((a, b) => a.s - b.s);

  const merged: Array<{ s: number; e: number }> = [];
  for (const c of clipped) {
    const last = merged[merged.length - 1];
    if (last && c.s <= last.e) last.e = Math.max(last.e, c.e);
    else merged.push({ ...c });
  }

  const gaps: Interval[] = [];
  let cursor = f;
  let covered = 0;
  for (const m of merged) {
    if (m.s > cursor) gaps.push({ startsAt: new Date(cursor), endsAt: new Date(m.s) });
    covered += m.e - m.s;
    cursor = m.e;
  }
  if (cursor < t) gaps.push({ startsAt: new Date(cursor), endsAt: new Date(t) });

  const total = Math.max(0, t - f);
  const percent = total === 0 ? 0 : Math.round((covered / total) * 1000) / 10;
  return { coveredMs: covered, totalMs: total, percent, gaps };
}
