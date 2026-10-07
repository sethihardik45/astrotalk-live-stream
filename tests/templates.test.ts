import { describe, expect, it } from "vitest";
import { expandTemplates, type ExistingShiftLike, type TemplateLike } from "@/lib/schedule/templates";
import { istParts, istToUtc } from "@/lib/time";

const daily = (id: string, who: string, time: string, dur = 60): TemplateLike => ({
  id,
  astrologerId: who,
  startTimeLocal: time,
  durationMinutes: dur,
  daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
  enabled: true,
});

describe("template expansion", () => {
  it("creates one shift per matching day, at the right IST instant", () => {
    const r = expandTemplates({ templates: [daily("t1", "ravi", "14:00")], fromDate: "2026-10-07", days: 3, existing: [], exceptions: new Set() });
    expect(r.create).toHaveLength(3);
    expect(r.create[0].startsAt).toEqual(istToUtc("2026-10-07", "14:00"));
    expect(r.create[0].endsAt.getTime() - r.create[0].startsAt.getTime()).toBe(3_600_000);
    // 14:00 IST is 08:30 UTC
    expect(r.create[0].startsAt.toISOString()).toBe("2026-10-07T08:30:00.000Z");
  });

  it("only uses the chosen days of week (0 = Sunday)", () => {
    // 2026-10-07 is a Wednesday (3)
    const t: TemplateLike = { ...daily("t1", "ravi", "14:00"), daysOfWeek: [3, 5] };
    const r = expandTemplates({ templates: [t], fromDate: "2026-10-07", days: 7, existing: [], exceptions: new Set() });
    expect(r.create.map((s) => s.templateDate)).toEqual(["2026-10-07", "2026-10-09"]);
  });

  it("is idempotent: expanding again creates nothing", () => {
    const first = expandTemplates({ templates: [daily("t1", "ravi", "14:00")], fromDate: "2026-10-07", days: 14, existing: [], exceptions: new Set() });
    const existing: ExistingShiftLike[] = first.create.map((c, i) => ({ id: `s${i}`, ...c }));
    const second = expandTemplates({ templates: [daily("t1", "ravi", "14:00")], fromDate: "2026-10-07", days: 14, existing, exceptions: new Set() });
    expect(second.create).toHaveLength(0);
    expect(second.skipped.every((s) => s.reason === "already-exists")).toBe(true);
  });

  it("never overwrites a manual edit: a moved generated shift is left where ops put it", () => {
    const moved: ExistingShiftLike = {
      id: "s1",
      templateId: "t1",
      templateDate: "2026-10-07",
      startsAt: istToUtc("2026-10-07", "16:00"),
      endsAt: istToUtc("2026-10-07", "17:00"),
    };
    const r = expandTemplates({ templates: [daily("t1", "ravi", "14:00")], fromDate: "2026-10-07", days: 1, existing: [moved], exceptions: new Set() });
    expect(r.create).toHaveLength(0);
  });

  it("does not resurrect shifts ops deleted", () => {
    const r = expandTemplates({ templates: [daily("t1", "ravi", "14:00")], fromDate: "2026-10-07", days: 2, existing: [], exceptions: new Set(["t1|2026-10-07"]) });
    expect(r.create.map((s) => s.templateDate)).toEqual(["2026-10-08"]);
    expect(r.skipped[0].reason).toBe("deleted-by-ops");
  });

  it("skips slots that would overlap an existing manual shift", () => {
    const manual: ExistingShiftLike = { id: "m", startsAt: istToUtc("2026-10-07", "14:30"), endsAt: istToUtc("2026-10-07", "15:30") };
    const r = expandTemplates({ templates: [daily("t1", "ravi", "14:00")], fromDate: "2026-10-07", days: 1, existing: [manual], exceptions: new Set() });
    expect(r.create).toHaveLength(0);
    expect(r.skipped[0].reason).toBe("overlaps");
  });

  it("two templates fighting for the same hour: only one wins, deterministically", () => {
    const a = expandTemplates({ templates: [daily("t2", "meera", "14:00"), daily("t1", "ravi", "14:00")], fromDate: "2026-10-07", days: 1, existing: [], exceptions: new Set() });
    expect(a.create).toHaveLength(1);
    expect(a.create[0].astrologerId).toBe("ravi"); // t1 sorts first
  });

  it("back-to-back templates both succeed", () => {
    const r = expandTemplates({ templates: [daily("t1", "ravi", "14:00"), daily("t2", "meera", "15:00")], fromDate: "2026-10-07", days: 1, existing: [], exceptions: new Set() });
    expect(r.create).toHaveLength(2);
  });

  it("handles a shift that crosses midnight IST", () => {
    const r = expandTemplates({ templates: [daily("t1", "ravi", "23:30", 60)], fromDate: "2026-10-07", days: 1, existing: [], exceptions: new Set() });
    const end = istParts(r.create[0].endsAt);
    expect(end).toMatchObject({ day: 8, hour: 0, minute: 30 });
  });

  it("ignores disabled templates", () => {
    const r = expandTemplates({ templates: [{ ...daily("t1", "ravi", "14:00"), enabled: false }], fromDate: "2026-10-07", days: 3, existing: [], exceptions: new Set() });
    expect(r.create).toHaveLength(0);
  });
});
