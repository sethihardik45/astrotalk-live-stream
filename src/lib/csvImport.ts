import { parseCsv } from "./csv";
import { type Interval, overlaps, validateShiftTimes } from "./schedule/overlap";
import { addDaysToKey, istToUtc, parseHHmm } from "./time";

/**
 * Bulk import. One CSV, one row per SHIFT (or per astrologer if the date/time columns are left empty):
 *
 *   name,tagline,photo_url,date,start_time,end_time
 *   Pandit Ravi Shankar,Vedic Astrologer,,2026-10-08,14:00,15:00
 *
 *  - Astrologers are matched by name (ignoring capitals and extra spaces). Unknown names are created.
 *  - date is an IST calendar date (yyyy-mm-dd; dd/mm/yyyy and dd-mm-yyyy are accepted too, because Excel likes to change formats).
 *  - times are HH:mm in IST. If the end is not after the start the shift runs past midnight (23:30 to 00:30).
 *  - Every row is checked; bad rows are reported with their line number and skipped, good rows are imported.
 * This file is PURE (no database): it only produces a plan, which the caller can show as a preview or carry out.
 */

export const MAX_IMPORT_ROWS = 2000;

export interface ExistingAstrologer {
  id: string;
  name: string;
  active: boolean;
}

export interface PlannedAstrologer {
  key: string;
  name: string;
  tagline: string | null;
  photoUrl: string | null;
}

export interface PlannedShift {
  line: number;
  astrologerKey: string;
  astrologerName: string;
  startsAt: Date;
  endsAt: Date;
}

export interface ImportPlan {
  astrologersToCreate: PlannedAstrologer[];
  shiftsToCreate: PlannedShift[];
  errors: Array<{ line: number; message: string }>;
  rowCount: number;
}

export const nameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

const HEADER_ALIASES: Record<string, string> = {
  name: "name",
  astrologer: "name",
  "astrologer name": "name",
  tagline: "tagline",
  title: "tagline",
  photo_url: "photo_url",
  photo: "photo_url",
  photourl: "photo_url",
  date: "date",
  start: "start",
  start_time: "start",
  "start time": "start",
  end: "end",
  end_time: "end",
  "end time": "end",
};

function normalizeDate(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return fmt(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(t); // dd/mm/yyyy (Indian convention)
  if (m) return fmt(+m[3], +m[2], +m[1]);
  return null;
}
function fmt(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null; // e.g. 31 Feb
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function normalizeTime(s: string): string | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s.trim());
  if (!m) return null;
  const hhmm = `${m[1].padStart(2, "0")}:${m[2]}`;
  try {
    parseHHmm(hhmm);
    return hhmm;
  } catch {
    return null;
  }
}

export function planImport(args: { csv: string; astrologers: ExistingAstrologer[]; existingShifts: Interval[] }): ImportPlan {
  const plan: ImportPlan = { astrologersToCreate: [], shiftsToCreate: [], errors: [], rowCount: 0 };
  const rows = parseCsv(args.csv);
  if (rows.length === 0) {
    plan.errors.push({ line: 1, message: "The file is empty." });
    return plan;
  }

  const header = rows[0].map((h) => HEADER_ALIASES[h.trim().toLowerCase()] ?? "");
  if (!header.includes("name")) {
    plan.errors.push({ line: 1, message: "The first row must be a header with a “name” column. Download the sample file to see the format." });
    return plan;
  }
  const col = (r: string[], key: string) => {
    const i = header.indexOf(key);
    return i >= 0 ? (r[i] ?? "").trim() : "";
  };

  const body = rows.slice(1);
  if (body.length > MAX_IMPORT_ROWS) {
    plan.errors.push({ line: 1, message: `Too many rows (limit ${MAX_IMPORT_ROWS}). Please split the file.` });
    return plan;
  }
  plan.rowCount = body.length;

  const existing = new Map(args.astrologers.map((a) => [nameKey(a.name), a]));
  const created = new Map<string, PlannedAstrologer>();
  const occupied: Interval[] = [...args.existingShifts];

  body.forEach((r, idx) => {
    const line = idx + 2; // +1 for the header, +1 because humans count from 1
    const fail = (message: string) => plan.errors.push({ line, message });

    const name = col(r, "name").replace(/\s+/g, " ");
    if (!name) return fail("The name is empty.");
    if (name.length > 80) return fail("The name is too long (80 characters at most).");
    const tagline = col(r, "tagline") || null;
    if (tagline && tagline.length > 120) return fail("The tagline is too long (120 characters at most).");
    const photo = col(r, "photo_url") || null;
    if (photo && !/^https:\/\/\S+$/i.test(photo)) return fail("The photo address must start with https://");

    const key = nameKey(name);
    const known = existing.get(key);
    if (known && !known.active) return fail(`${known.name} is switched off (inactive). Switch them on first.`);

    const dateRaw = col(r, "date");
    const startRaw = col(r, "start");
    const endRaw = col(r, "end");
    const hasShift = dateRaw || startRaw || endRaw;

    let shift: { startsAt: Date; endsAt: Date } | null = null;
    if (hasShift) {
      if (!dateRaw || !startRaw || !endRaw) return fail("A shift needs all three of: date, start_time and end_time.");
      const date = normalizeDate(dateRaw);
      if (!date) return fail(`The date “${dateRaw}” is not valid. Use yyyy-mm-dd, for example 2026-10-08.`);
      const start = normalizeTime(startRaw);
      const end = normalizeTime(endRaw);
      if (!start) return fail(`The start time “${startRaw}” is not valid. Use HH:mm, for example 14:00.`);
      if (!end) return fail(`The end time “${endRaw}” is not valid. Use HH:mm, for example 15:00.`);
      const startsAt = istToUtc(date, start);
      let endsAt = istToUtc(date, end);
      if (endsAt.getTime() <= startsAt.getTime()) endsAt = istToUtc(addDaysToKey(date, 1), end); // crosses midnight
      const bad = validateShiftTimes({ startsAt, endsAt });
      if (bad) return fail(bad);
      const clash = occupied.find((o) => overlaps({ startsAt, endsAt }, o));
      if (clash) return fail("This shift overlaps another shift (one already in the schedule, or an earlier row in this file).");
      shift = { startsAt, endsAt };
    }

    // Row is good: register the astrologer (if new) and the shift.
    if (!known && !created.has(key)) created.set(key, { key, name, tagline, photoUrl: photo });
    if (shift) {
      occupied.push(shift);
      plan.shiftsToCreate.push({ line, astrologerKey: key, astrologerName: known?.name ?? name, ...shift });
    }
  });

  plan.astrologersToCreate = [...created.values()];
  return plan;
}

/** The sample file offered for download. */
export const SAMPLE_CSV = `name,tagline,photo_url,date,start_time,end_time
Pandit Ravi Shankar,Vedic Astrologer,,2026-10-12,14:00,15:00
Meera Joshi,Tarot & Numerology,,2026-10-12,15:00,16:00
Meera Joshi,Tarot & Numerology,,2026-10-13,15:00,16:00
Acharya Arun Mishra,KP Astrology,,2026-10-12,23:30,00:30
Dr. Kavita Rao,Vastu Expert,,,,
`;
