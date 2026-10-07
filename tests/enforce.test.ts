import { describe, expect, it } from "vitest";
import { planEnforcement } from "@/lib/schedule/enforce";
import { at, MIN, shift } from "./helpers";

const base = {
  leadMs: 10 * MIN,
  graceMs: 30_000,
  activeAstrologerIds: new Set(["ravi", "meera", "arun"]),
};
const shifts = [shift("a", "ravi", "14:00", "15:00"), shift("b", "meera", "15:00", "16:00")];

describe("planEnforcement — server-side permission rules", () => {
  it("grants publish only to the on-air astrologer", () => {
    const plan = planEnforcement({
      ...base,
      shifts,
      now: at("14:55"), // meera's green room (opens 14:50) is open, ravi is on air
      participants: [
        { identity: "ravi", canPublish: false },
        { identity: "meera", canPublish: false },
      ],
    });
    expect(plan.onAirIdentity).toBe("ravi");
    expect(plan.grant).toEqual(["ravi"]);
    expect(plan.revoke).toEqual([]);
    expect(plan.remove).toEqual([]);
  });

  it("revokes publish from anyone else who somehow has it (tampering / stale grant)", () => {
    const plan = planEnforcement({
      ...base,
      shifts,
      now: at("14:55"),
      participants: [
        { identity: "ravi", canPublish: true },
        { identity: "meera", canPublish: true },
      ],
    });
    expect(plan.grant).toEqual([]);
    expect(plan.revoke).toEqual(["meera"]);
  });

  it("hand-off at the exact boundary: ravi revoked, meera granted, nobody removed (still in grace)", () => {
    const plan = planEnforcement({
      ...base,
      shifts,
      now: at("15:00"),
      participants: [
        { identity: "ravi", canPublish: true },
        { identity: "meera", canPublish: false },
      ],
    });
    expect(plan.onAirIdentity).toBe("meera");
    expect(plan.grant).toEqual(["meera"]);
    expect(plan.revoke).toEqual(["ravi"]);
    expect(plan.remove).toEqual([]);
  });

  it("removes a finished astrologer only AFTER the grace period", () => {
    const within = planEnforcement({ ...base, shifts, now: at("15:00", "2026-10-07", 29), participants: [{ identity: "ravi", canPublish: false }] });
    expect(within.remove).toEqual([]);
    const after = planEnforcement({ ...base, shifts, now: at("15:00", "2026-10-07", 30), participants: [{ identity: "ravi", canPublish: false }] });
    expect(after.remove).toEqual(["ravi"]);
  });

  it("removes people who connect too early (before the green room opens)", () => {
    const plan = planEnforcement({ ...base, shifts, now: at("13:49"), participants: [{ identity: "ravi", canPublish: false }] });
    expect(plan.remove).toEqual(["ravi"]);
    const ok = planEnforcement({ ...base, shifts, now: at("13:50"), participants: [{ identity: "ravi", canPublish: false }] });
    expect(ok.remove).toEqual([]);
  });

  it("removes unknown identities and inactive astrologers", () => {
    const plan = planEnforcement({
      ...base,
      activeAstrologerIds: new Set(["meera"]),
      shifts,
      now: at("14:30"),
      participants: [
        { identity: "stranger", canPublish: true },
        { identity: "ravi", canPublish: false },
      ],
    });
    expect(plan.remove.sort()).toEqual(["ravi", "stranger"]);
    expect(plan.onAirIdentity).toBeNull();
  });

  it("nobody scheduled -> onAirIdentity null (layout shows transition video)", () => {
    const plan = planEnforcement({ ...base, shifts, now: at("20:00"), participants: [] });
    expect(plan.onAirIdentity).toBeNull();
    expect(plan.nextShift).toBeNull();
  });

  it("a blocked shift (ops removed from stage) is treated as non-existent", () => {
    const plan = planEnforcement({
      ...base,
      shifts,
      now: at("14:30"),
      blockedShiftIds: new Set(["a"]),
      participants: [{ identity: "ravi", canPublish: true }],
    });
    expect(plan.onAirIdentity).toBeNull();
    expect(plan.remove).toEqual(["ravi"]);
  });

  it("back-to-back shifts for the SAME astrologer: no revoke/removal between them", () => {
    const mine = [shift("a", "ravi", "14:00", "15:00"), shift("b", "ravi", "15:00", "16:00")];
    const plan = planEnforcement({ ...base, shifts: mine, now: at("15:00"), participants: [{ identity: "ravi", canPublish: true }] });
    expect(plan).toMatchObject({ onAirIdentity: "ravi", grant: [], revoke: [], remove: [] });
  });
});

describe("planEnforcement — early arrivals", () => {
  it("someone who is early (outside the green room) is removed, not left idle in the room", () => {
    const plan = planEnforcement({
      ...base,
      shifts,
      now: at("14:30"),
      participants: [{ identity: "meera", canPublish: false }],
    });
    expect(plan.remove).toEqual(["meera"]);
  });
});
