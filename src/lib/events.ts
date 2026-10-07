import { db } from "./db";
import { redact } from "./redact";

/**
 * Write one line to the ops event log (shown on the ops dashboard, newest first).
 * The message is passed through `redact` as a last line of defence, but callers must never include
 * stream keys or URLs in the first place.
 */
export async function logEvent(type: string, message: string): Promise<void> {
  try {
    await db.eventLog.create({ data: { type, message: redact(message).slice(0, 500) } });
  } catch (e) {
    // Logging must never break the caller (e.g. the 2-second worker loop).
    console.error("[events] could not write event:", e instanceof Error ? e.message : "unknown");
  }
}

export async function recentEvents(limit = 100) {
  return db.eventLog.findMany({ orderBy: { at: "desc" }, take: limit });
}

/** Keep the table small: delete everything except the newest `keep` rows. Called now and then by the worker. */
export async function pruneEvents(keep = 1000): Promise<void> {
  const cutoff = await db.eventLog.findMany({ orderBy: { at: "desc" }, skip: keep, take: 1, select: { at: true } });
  if (cutoff[0]) await db.eventLog.deleteMany({ where: { at: { lte: cutoff[0].at } } });
}
