/**
 * Time helpers. EVERYTHING is stored and computed in UTC. IST (Asia/Kolkata) is used only for:
 *   - turning "14:00 IST on 2026-10-07" into a UTC instant (templates, CSV import, grid clicks)
 *   - showing times to humans
 *
 * IST is a fixed UTC+05:30 all year (India has no daylight saving), so we can do this with simple
 * arithmetic instead of pulling in a timezone library. If this ever has to support a zone with DST,
 * replace this file — nothing else does timezone maths.
 */

export const IST_OFFSET_MINUTES = 330;
const MS_MIN = 60_000;
const MS_DAY = 86_400_000;

export interface IstParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number;
  minute: number;
  /** 0 = Sunday ... 6 = Saturday, for the IST calendar day */
  dow: number;
}

/** Break a UTC instant into its IST calendar fields. */
export function istParts(d: Date): IstParts {
  const shifted = new Date(d.getTime() + IST_OFFSET_MINUTES * MS_MIN);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    dow: shifted.getUTCDay(),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-10-07" — the IST calendar date of an instant. */
export function istDateKey(d: Date): string {
  const p = istParts(d);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function parseDateKey(key: string): { year: number; month: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) throw new Error(`Bad date key: ${key}`);
  return { year: +m[1], month: +m[2], day: +m[3] };
}

/** Add whole days to a "yyyy-mm-dd" key (pure calendar maths, no timezone involved). */
export function addDaysToKey(key: string, days: number): string {
  const { year, month, day } = parseDateKey(key);
  const d = new Date(Date.UTC(year, month - 1, day) + days * MS_DAY);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Day of week (0 = Sunday) of a "yyyy-mm-dd" calendar date. */
export function dowOfKey(key: string): number {
  const { year, month, day } = parseDateKey(key);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** "HH:mm" -> minutes since midnight. Throws on bad input. */
export function parseHHmm(s: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s);
  if (!m) throw new Error(`Bad time "${s}", expected HH:mm`);
  return +m[1] * 60 + +m[2];
}

/** The UTC instant for a given IST calendar date + "HH:mm". */
export function istToUtc(dateKey: string, hhmm: string): Date {
  const { year, month, day } = parseDateKey(dateKey);
  const minutes = parseHHmm(hhmm);
  const utcMs = Date.UTC(year, month - 1, day) + minutes * MS_MIN - IST_OFFSET_MINUTES * MS_MIN;
  return new Date(utcMs);
}

/** Midnight (00:00 IST) at the start of the IST day that contains `d`, as a UTC instant. */
export function startOfIstDay(d: Date): Date {
  return istToUtc(istDateKey(d), "00:00");
}

// ---------- display (human-facing) ----------

const DISPLAY_TZ = "Asia/Kolkata";

/** "2:00 pm" style time in IST. */
export function formatTimeIst(d: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: DISPLAY_TZ,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(d)
    .toLowerCase();
}

/** "Wed 7 Oct, 2:00 pm IST" */
export function formatDateTimeIst(d: Date): string {
  const date = new Intl.DateTimeFormat("en-IN", {
    timeZone: DISPLAY_TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(d);
  return `${date}, ${formatTimeIst(d)} IST`;
}

/** 3725 -> "1:02:05", 125 -> "2:05" */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
