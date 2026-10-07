import { type ShiftLike } from "./types";
import { computeSchedule } from "./onAir";

/**
 * Decide what the LiveKit room must look like right now. PURE: it only returns a plan;
 * `src/lib/enforce.ts` carries the plan out against LiveKit.
 *
 * Rules (the heart of "server-enforced schedule"):
 *  1. Only the astrologer whose shift contains `now` may publish. Everyone else: canPublish = false.
 *  2. Someone may stay in the room from (start - lead) until (end + grace). Outside that window they are removed.
 *  3. Participants whose identity is not a known astrologer are removed (we only ever mint tokens for astrologers).
 *  4. A shift in `blockedShiftIds` (ops pressed "Remove from stage") is treated as if it did not exist.
 */

export interface RoomParticipantLite {
  /** Equals Astrologer.id (we mint tokens that way). */
  identity: string;
  canPublish: boolean;
}

export interface EnforcementPlan {
  onAirShift: ShiftLike | null;
  onAirIdentity: string | null;
  nextShift: ShiftLike | null;
  /** Identities that must be given canPublish = true. */
  grant: string[];
  /** Identities that must be given canPublish = false. */
  revoke: string[];
  /** Identities that must be kicked out of the room. */
  remove: string[];
}

export interface EnforcementInput {
  participants: RoomParticipantLite[];
  shifts: ShiftLike[];
  now: Date;
  leadMs: number;
  graceMs: number;
  blockedShiftIds?: Set<string>;
  /** Only astrologers whose record is active may appear. */
  activeAstrologerIds: Set<string>;
}

export function planEnforcement(input: EnforcementInput): EnforcementPlan {
  const { participants, now, leadMs, graceMs } = input;
  const blocked = input.blockedShiftIds ?? new Set<string>();
  const shifts = input.shifts.filter((s) => !blocked.has(s.id) && input.activeAstrologerIds.has(s.astrologerId));

  const view = computeSchedule(shifts, now, leadMs);
  const onAirIdentity = view.onAir?.astrologerId ?? null;
  const t = now.getTime();

  const mayBeInRoom = (identity: string): boolean =>
    shifts.some(
      (s) =>
        s.astrologerId === identity &&
        t >= s.startsAt.getTime() - leadMs &&
        t < s.endsAt.getTime() + graceMs,
    );

  const grant: string[] = [];
  const revoke: string[] = [];
  const remove: string[] = [];

  for (const p of participants) {
    if (!mayBeInRoom(p.identity)) {
      remove.push(p.identity);
      continue;
    }
    if (p.identity === onAirIdentity) {
      if (!p.canPublish) grant.push(p.identity);
    } else if (p.canPublish) {
      revoke.push(p.identity);
    }
  }

  return { onAirShift: view.onAir, onAirIdentity, nextShift: view.next, grant, revoke, remove };
}
