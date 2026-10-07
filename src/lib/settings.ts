import { db } from "./db";
import { env } from "./env";

/**
 * Key/value settings in the database (editable at runtime without a restart).
 * Defaults come from environment variables or the constants below.
 */
export const SETTING_KEYS = {
  transitionOn: "transitionOn", // "true" | "false" — ops "Show transition video" switch
  forceMute: "forceMute", // the id of the SHIFT ops muted (so the next astrologer is not muted by accident), or empty
  transitionUrl: "transitionUrl", // path or URL of the transition video
  greenRoomLeadMinutes: "greenRoomLeadMinutes",
  warningMinutes: "warningMinutes", // comma list, e.g. "5,1"
} as const;

export const DEFAULT_TRANSITION_URL = "/brand/transition.mp4";

export async function getSetting(key: string): Promise<string | null> {
  const row = await db.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

export async function getBool(key: string): Promise<boolean> {
  return (await getSetting(key)) === "true";
}

export interface RuntimeSettings {
  leadMs: number;
  graceMs: number;
  warnMinutes: number[];
  transitionOn: boolean;
  /** Shift id that ops muted, or null. Only that shift is muted. */
  forceMuteShiftId: string | null;
  transitionUrl: string;
}

export async function loadSettings(): Promise<RuntimeSettings> {
  const rows = await db.setting.findMany();
  const m = new Map(rows.map((r) => [r.key, r.value]));
  const leadMin = Number(m.get(SETTING_KEYS.greenRoomLeadMinutes)) || env().GREEN_ROOM_LEAD_MINUTES;
  const warn = (m.get(SETTING_KEYS.warningMinutes) ?? "5,1")
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => b - a);
  return {
    leadMs: leadMin * 60_000,
    graceMs: env().HANDOFF_GRACE_SECONDS * 1000,
    warnMinutes: warn.length ? warn : [5, 1],
    transitionOn: m.get(SETTING_KEYS.transitionOn) === "true",
    forceMuteShiftId: m.get(SETTING_KEYS.forceMute) || null,
    transitionUrl: m.get(SETTING_KEYS.transitionUrl) || DEFAULT_TRANSITION_URL,
  };
}
