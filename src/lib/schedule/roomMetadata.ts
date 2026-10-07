/**
 * The JSON we write into the LiveKit ROOM METADATA. The egress layout page (/egress-layout) reads it
 * live, so the video composition changes without any reconnecting.
 */
export interface RoomMetadata {
  /** Astrologer id (= LiveKit identity) of the person who should be on screen, or null. */
  onAirIdentity: string | null;
  onAirName: string | null;
  onAirTagline: string | null;
  nextName: string | null;
  /** ISO string (UTC). The layout formats it in IST. */
  nextStartsAt: string | null;
  /** Ops "Show transition video" switch. */
  transition: boolean;
  /** Ops "Mute on-air astrologer": the layout silences audio even if the astrologer unmutes. */
  muted: boolean;
  /** Transition video URL (path or absolute). */
  transitionUrl: string;
}

export const EMPTY_METADATA: RoomMetadata = {
  onAirIdentity: null,
  onAirName: null,
  onAirTagline: null,
  nextName: null,
  nextStartsAt: null,
  transition: false,
  muted: false,
  transitionUrl: "/brand/transition.mp4",
};

/** Parse metadata defensively: a bad value must never crash the layout, it just shows the transition video. */
export function parseRoomMetadata(raw: string | undefined | null): RoomMetadata {
  if (!raw) return { ...EMPTY_METADATA };
  try {
    const j = JSON.parse(raw) as Partial<RoomMetadata>;
    return {
      onAirIdentity: typeof j.onAirIdentity === "string" ? j.onAirIdentity : null,
      onAirName: typeof j.onAirName === "string" ? j.onAirName : null,
      onAirTagline: typeof j.onAirTagline === "string" ? j.onAirTagline : null,
      nextName: typeof j.nextName === "string" ? j.nextName : null,
      nextStartsAt: typeof j.nextStartsAt === "string" ? j.nextStartsAt : null,
      transition: j.transition === true,
      muted: j.muted === true,
      transitionUrl: typeof j.transitionUrl === "string" && j.transitionUrl ? j.transitionUrl : EMPTY_METADATA.transitionUrl,
    };
  } catch {
    return { ...EMPTY_METADATA };
  }
}

/** Stable string so we can skip LiveKit calls when nothing changed. */
export function serializeRoomMetadata(m: RoomMetadata): string {
  return JSON.stringify({
    onAirIdentity: m.onAirIdentity,
    onAirName: m.onAirName,
    onAirTagline: m.onAirTagline,
    nextName: m.nextName,
    nextStartsAt: m.nextStartsAt,
    transition: m.transition,
    muted: m.muted,
    transitionUrl: m.transitionUrl,
  });
}
