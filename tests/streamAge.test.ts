import { describe, expect, it } from "vitest";
import { ageTone, streamAgeSeconds } from "@/lib/streamAge";

const hms = (h: number, m: number, s = 0) => h * 3600 + m * 60 + s;

describe("stream age colours (Instagram 4-hour limit)", () => {
  it("is green under 3h30", () => {
    expect(ageTone(0)).toBe("green");
    expect(ageTone(hms(3, 29, 59))).toBe("green");
  });
  it("turns amber at exactly 3h30 and stays amber until 3h50", () => {
    expect(ageTone(hms(3, 30))).toBe("amber");
    expect(ageTone(hms(3, 49, 59))).toBe("amber");
  });
  it("turns red at exactly 3h50, and stays red past 4h", () => {
    expect(ageTone(hms(3, 50))).toBe("red");
    expect(ageTone(hms(4, 10))).toBe("red");
  });
  it("has no colour while a new stream is only a preview", () => {
    expect(ageTone(null)).toBe("none");
    expect(streamAgeSeconds(null, Date.now())).toBeNull();
  });
  it("computes age from the live time, never negative", () => {
    const live = new Date("2026-10-07T10:00:00Z");
    expect(streamAgeSeconds(live.toISOString(), live.getTime() + 3_600_000)).toBe(3600);
    expect(streamAgeSeconds(live.toISOString(), live.getTime() - 5000)).toBe(0);
  });
});
