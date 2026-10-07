import { describe, expect, it } from "vitest";
import { astrologerStatus, chainEnd, computeSchedule } from "@/lib/schedule/onAir";
import { at, MIN, shift } from "./helpers";

const LEAD = 10 * MIN;

describe("computeSchedule — who is on air", () => {
  const shifts = [shift("a", "ravi", "14:00", "15:00"), shift("b", "meera", "15:00", "16:00"), shift("c", "arun", "17:00", "18:00")];

  it("picks the shift containing now", () => {
    const v = computeSchedule(shifts, at("14:30"), LEAD);
    expect(v.onAir?.id).toBe("a");
    expect(v.next?.id).toBe("b");
  });

  it("a shift starting exactly at the tick is ON AIR (start is inclusive)", () => {
    const v = computeSchedule(shifts, at("14:00"), LEAD);
    expect(v.onAir?.id).toBe("a");
  });

  it("one millisecond before the start it is not on air yet", () => {
    const v = computeSchedule(shifts, at("14:00", "2026-10-07", 0, -1), LEAD);
    expect(v.onAir).toBeNull();
    expect(v.next?.id).toBe("a");
  });

  it("a shift ending exactly at the tick is OFF AIR (end is exclusive)", () => {
    const v = computeSchedule([shift("a", "ravi", "14:00", "15:00")], at("15:00"), LEAD);
    expect(v.onAir).toBeNull();
  });

  it("back-to-back: at the exact boundary the NEXT astrologer is on air, with no gap and no overlap", () => {
    const v = computeSchedule(shifts, at("15:00"), LEAD);
    expect(v.onAir?.id).toBe("b");
    const justBefore = computeSchedule(shifts, at("15:00", "2026-10-07", 0, -1), LEAD);
    expect(justBefore.onAir?.id).toBe("a");
  });

  it("gap: nobody on air, next is the following shift", () => {
    const v = computeSchedule(shifts, at("16:30"), LEAD);
    expect(v.onAir).toBeNull();
    expect(v.next?.id).toBe("c");
  });

  it("nothing scheduled at all", () => {
    const v = computeSchedule([], at("12:00"), LEAD);
    expect(v).toEqual({ onAir: null, next: null, greenRoom: [] });
  });

  it("green room = shifts starting within the lead time", () => {
    expect(computeSchedule(shifts, at("16:50"), LEAD).greenRoom.map((s) => s.id)).toEqual(["c"]);
    expect(computeSchedule(shifts, at("16:49"), LEAD).greenRoom).toEqual([]);
    // exactly lead minutes before: included
    expect(computeSchedule(shifts, at("16:50"), LEAD).greenRoom).toHaveLength(1);
  });

  it("while someone is on air, the following shift within lead is in the green room", () => {
    const v = computeSchedule(shifts, at("14:55"), LEAD);
    expect(v.onAir?.id).toBe("a");
    expect(v.greenRoom.map((s) => s.id)).toEqual(["b"]);
  });

  it("is deterministic even if bad data overlaps: earliest-started wins", () => {
    const bad = [shift("late", "x", "14:10", "15:00"), shift("early", "y", "14:00", "14:30")];
    expect(computeSchedule(bad, at("14:20"), LEAD).onAir?.id).toBe("early");
  });

  it("worker restart mid-shift: same answer, because it only depends on data + now", () => {
    const a = computeSchedule(shifts, at("14:41"), LEAD);
    const b = computeSchedule([...shifts].reverse(), at("14:41"), LEAD);
    expect(a.onAir?.id).toBe(b.onAir?.id);
  });
});

describe("astrologerStatus — what one astrologer's page shows", () => {
  const mine = [shift("a", "ravi", "14:00", "15:00"), shift("b", "ravi", "20:00", "21:00")];

  it("no shifts at all -> none", () => {
    expect(astrologerStatus([], at("12:00"), LEAD).phase).toBe("none");
  });
  it("more than lead before -> waiting", () => {
    expect(astrologerStatus(mine, at("13:49"), LEAD).phase).toBe("waiting");
  });
  it("exactly lead before -> greenroom", () => {
    expect(astrologerStatus(mine, at("13:50"), LEAD).phase).toBe("greenroom");
  });
  it("at start -> onair", () => {
    const s = astrologerStatus(mine, at("14:00"), LEAD);
    expect(s.phase).toBe("onair");
    expect(s.shift?.id).toBe("a");
  });
  it("at end -> over (thank you), pointing at the next shift", () => {
    const s = astrologerStatus(mine, at("15:00"), LEAD);
    expect(s.phase).toBe("over");
    expect(s.nextShift?.id).toBe("b");
  });
  it("long after end with a later shift -> waiting again", () => {
    expect(astrologerStatus(mine, at("16:00"), LEAD).phase).toBe("waiting");
  });
  it("green room beats 'over' when the next shift is near", () => {
    const m = [shift("a", "ravi", "14:00", "15:00"), shift("b", "ravi", "15:05", "16:00")];
    expect(astrologerStatus(m, at("15:01"), LEAD).phase).toBe("greenroom");
  });
  it("after the last shift, after the over window -> none", () => {
    expect(astrologerStatus([shift("a", "ravi", "14:00", "15:00")], at("16:00"), LEAD).phase).toBe("none");
  });
});

describe("chainEnd", () => {
  it("follows back-to-back shifts of the same astrologer", () => {
    const m = [shift("a", "r", "14:00", "15:00"), shift("b", "r", "15:00", "16:00"), shift("c", "r", "17:00", "18:00")];
    expect(chainEnd(m, m[0]).getTime()).toBe(m[1].endsAt.getTime());
  });
});
