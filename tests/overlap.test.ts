import { describe, expect, it } from "vitest";
import { computeCoverage, findConflict, findOverlaps, overlaps, validateShiftTimes } from "@/lib/schedule/overlap";
import { at, shift } from "./helpers";

describe("overlap validation", () => {
  it("back-to-back shifts do NOT overlap", () => {
    expect(overlaps(shift("a", "x", "14:00", "15:00"), shift("b", "y", "15:00", "16:00"))).toBe(false);
  });
  it("one minute of sharing IS an overlap", () => {
    expect(overlaps(shift("a", "x", "14:00", "15:01"), shift("b", "y", "15:00", "16:00"))).toBe(true);
  });
  it("a shift fully inside another overlaps", () => {
    expect(overlaps(shift("a", "x", "14:00", "18:00"), shift("b", "y", "15:00", "16:00"))).toBe(true);
  });
  it("findConflict rejects an overlapping new shift but allows editing a shift in place (ignoreId)", () => {
    const existing = [shift("a", "x", "14:00", "15:00"), shift("b", "y", "15:00", "16:00")];
    expect(findConflict(shift("n", "z", "14:30", "15:30"), existing)?.id).toBe("a");
    expect(findConflict(shift("a", "x", "14:00", "14:45"), existing, "a")).toBeNull();
    expect(findConflict(shift("n", "z", "16:00", "17:00"), existing)).toBeNull();
  });
  it("findOverlaps lists every colliding pair", () => {
    const list = [shift("a", "x", "14:00", "15:00"), shift("b", "y", "14:30", "15:30"), shift("c", "z", "16:00", "17:00")];
    const pairs = findOverlaps(list);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].map((s) => s.id)).toEqual(["a", "b"]);
  });
  it("validates a shift's own times", () => {
    expect(validateShiftTimes(shift("a", "x", "15:00", "14:00"))).toMatch(/end after/);
    expect(validateShiftTimes(shift("a", "x", "14:00", "14:00"))).toMatch(/end after/);
    expect(validateShiftTimes(shift("a", "x", "00:00", "13:30"))).toMatch(/longer/);
    expect(validateShiftTimes(shift("a", "x", "14:00", "15:00"))).toBeNull();
    expect(validateShiftTimes({ startsAt: new Date("nope"), endsAt: new Date() })).toMatch(/valid/);
  });
});

describe("coverage", () => {
  it("full coverage is 100% with no gaps", () => {
    const list = [shift("a", "x", "00:00", "12:00"), shift("b", "y", "12:00", "24:00")];
    const c = computeCoverage(list, at("00:00"), at("00:00", "2026-10-08"));
    expect(c.percent).toBe(100);
    expect(c.gaps).toEqual([]);
  });
  it("reports gaps and does not double count overlaps", () => {
    const list = [shift("a", "x", "00:00", "06:00"), shift("b", "y", "03:00", "09:00")]; // union 00-09
    const c = computeCoverage(list, at("00:00"), at("12:00"));
    expect(c.percent).toBe(75);
    expect(c.gaps).toHaveLength(1);
    expect(c.gaps[0].startsAt).toEqual(at("09:00"));
    expect(c.gaps[0].endsAt).toEqual(at("12:00"));
  });
  it("empty schedule is 0% with one big gap", () => {
    const c = computeCoverage([], at("00:00"), at("06:00"));
    expect(c.percent).toBe(0);
    expect(c.gaps).toHaveLength(1);
  });
});
