/** The minimum a shift needs for schedule maths. Prisma's Shift satisfies this. */
export interface ShiftLike {
  id: string;
  astrologerId: string;
  /** Inclusive start (UTC instant). */
  startsAt: Date;
  /** Exclusive end (UTC instant). A shift [14:00, 15:00) and a shift [15:00, 16:00) do NOT overlap. */
  endsAt: Date;
}

export const MS_MIN = 60_000;
export const MS_SEC = 1_000;
