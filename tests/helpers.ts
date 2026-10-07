import type { ShiftLike } from "@/lib/schedule/types";
import { istToUtc } from "@/lib/time";

/** Build a shift from IST wall-clock times on 2026-10-07 (a Wednesday). */
export function shift(id: string, astrologerId: string, startHHmm: string, endHHmm: string, date = "2026-10-07"): ShiftLike {
  const startsAt = istToUtc(date, startHHmm);
  // "24:00" style ends are written as the next day 00:00
  const endsAt = endHHmm === "24:00" ? istToUtc(date, "00:00") : istToUtc(date, endHHmm);
  return { id, astrologerId, startsAt, endsAt: endHHmm === "24:00" ? new Date(endsAt.getTime() + 86_400_000) : endsAt };
}

export const at = (hhmm: string, date = "2026-10-07", seconds = 0, ms = 0) =>
  new Date(istToUtc(date, hhmm).getTime() + seconds * 1000 + ms);

export const MIN = 60_000;
