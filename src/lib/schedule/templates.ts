import { addDaysToKey, dowOfKey, istToUtc, parseHHmm } from "../time";
import { type Interval, overlaps } from "./overlap";
import { MS_MIN } from "./types";

export interface TemplateLike {
  id: string;
  astrologerId: string;
  /** "HH:mm" in IST */
  startTimeLocal: string;
  durationMinutes: number;
  /** 0 = Sunday ... 6 = Saturday; the IST day on which the shift STARTS */
  daysOfWeek: number[];
  enabled: boolean;
}

export interface ExistingShiftLike extends Interval {
  id: string;
  templateId?: string | null;
  templateDate?: string | null;
}

export interface NewShift {
  astrologerId: string;
  startsAt: Date;
  endsAt: Date;
  templateId: string;
  templateDate: string;
}

export type SkipReason = "already-exists" | "deleted-by-ops" | "overlaps";

export interface ExpansionResult {
  create: NewShift[];
  skipped: Array<{ templateId: string; date: string; reason: SkipReason }>;
}

/**
 * Turn recurring templates into concrete shifts for `days` IST calendar days starting at `fromDate`.
 *
 * Guarantees:
 *  - IDEMPOTENT: running it twice creates nothing the second time (we look at templateId + templateDate).
 *  - NEVER OVERWRITES manual edits: if ops moved/edited a generated shift, its (templateId, templateDate)
 *    still exists, so it is left alone. If ops deleted one, the date is in `exceptions` and stays deleted.
 *  - NEVER OVERLAPS: a slot colliding with any existing shift (or one we are about to create) is skipped.
 *    Templates are processed in a stable order (start time, then id) so the result is deterministic.
 */
export function expandTemplates(args: {
  templates: TemplateLike[];
  fromDate: string; // IST yyyy-mm-dd
  days: number;
  existing: ExistingShiftLike[];
  /** Set of "<templateId>|<yyyy-mm-dd>" that ops deleted on purpose. */
  exceptions: Set<string>;
}): ExpansionResult {
  const { templates, fromDate, days, existing, exceptions } = args;

  const have = new Set(
    existing.filter((s) => s.templateId && s.templateDate).map((s) => `${s.templateId}|${s.templateDate}`),
  );
  const occupied: Interval[] = existing.map((s) => ({ startsAt: s.startsAt, endsAt: s.endsAt }));

  const active = templates
    .filter((t) => t.enabled && t.durationMinutes > 0)
    .sort((a, b) => parseHHmm(a.startTimeLocal) - parseHHmm(b.startTimeLocal) || a.id.localeCompare(b.id));

  const result: ExpansionResult = { create: [], skipped: [] };

  for (let d = 0; d < days; d++) {
    const date = addDaysToKey(fromDate, d);
    const dow = dowOfKey(date);
    for (const t of active) {
      if (!t.daysOfWeek.includes(dow)) continue;
      const key = `${t.id}|${date}`;
      if (have.has(key)) {
        result.skipped.push({ templateId: t.id, date, reason: "already-exists" });
        continue;
      }
      if (exceptions.has(key)) {
        result.skipped.push({ templateId: t.id, date, reason: "deleted-by-ops" });
        continue;
      }
      const startsAt = istToUtc(date, t.startTimeLocal);
      const endsAt = new Date(startsAt.getTime() + t.durationMinutes * MS_MIN);
      const candidate = { startsAt, endsAt };
      if (occupied.some((o) => overlaps(candidate, o))) {
        result.skipped.push({ templateId: t.id, date, reason: "overlaps" });
        continue;
      }
      occupied.push(candidate);
      result.create.push({ astrologerId: t.astrologerId, startsAt, endsAt, templateId: t.id, templateDate: date });
    }
  }
  return result;
}
