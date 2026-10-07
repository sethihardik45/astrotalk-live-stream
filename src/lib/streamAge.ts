/**
 * Instagram ends a Live after 4 hours. The ops page warns in two steps:
 *   green  : under 3h30
 *   amber  : from 3h30   (prepare to rotate)
 *   red    : from 3h50   (rotate NOW)
 */
export const AMBER_SECONDS = 3 * 3600 + 30 * 60;
export const RED_SECONDS = 3 * 3600 + 50 * 60;

export type AgeTone = "none" | "green" | "amber" | "red";

/** `sec` is null while a new stream is only in preview (the 4-hour clock has not started). */
export function ageTone(sec: number | null): AgeTone {
  if (sec == null) return "none";
  return sec >= RED_SECONDS ? "red" : sec >= AMBER_SECONDS ? "amber" : "green";
}

/** Seconds since the stream went live on Instagram, or null if it has not yet. */
export function streamAgeSeconds(liveAt: string | null, nowMs: number): number | null {
  return liveAt ? Math.max(0, (nowMs - new Date(liveAt).getTime()) / 1000) : null;
}
