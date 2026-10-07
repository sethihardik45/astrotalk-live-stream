import { describe, expect, it } from "vitest";
import { generateSlug, looksLikeSlug } from "@/lib/slug";
import { joinRtmpUrl, RtmpInputError } from "@/lib/rtmp";
import { redact, safeErrorMessage } from "@/lib/redact";
import { addDaysToKey, dowOfKey, formatDuration, istDateKey, istParts, istToUtc, parseHHmm } from "@/lib/time";
import { parseRoomMetadata, serializeRoomMetadata, EMPTY_METADATA } from "@/lib/schedule/roomMetadata";

describe("slug", () => {
  it("is at least 24 URL-safe characters", () => {
    const s = generateSlug();
    expect(s.length).toBeGreaterThanOrEqual(24);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(looksLikeSlug(s)).toBe(true);
  });
  it("is unique across many generations", () => {
    const set = new Set(Array.from({ length: 5000 }, generateSlug));
    expect(set.size).toBe(5000);
  });
  it("rejects garbage shapes", () => {
    expect(looksLikeSlug("short")).toBe(false);
    expect(looksLikeSlug("has spaces and ../ chars 123456789012")).toBe(false);
    expect(looksLikeSlug(42)).toBe(false);
  });
});

describe("rtmp url joining", () => {
  const key = "abc123?s_bl=1&s_sc=xyz";
  it("adds exactly one slash", () => {
    expect(joinRtmpUrl("rtmps://live.example.com:443/rtmp/", key)).toBe(`rtmps://live.example.com:443/rtmp/${key}`);
    expect(joinRtmpUrl("rtmps://live.example.com:443/rtmp", key)).toBe(`rtmps://live.example.com:443/rtmp/${key}`);
    expect(joinRtmpUrl("rtmps://live.example.com:443/rtmp//", `/${key}`)).toBe(`rtmps://live.example.com:443/rtmp/${key}`);
  });
  it("trims pasted whitespace and newlines", () => {
    expect(joinRtmpUrl("  rtmp://a.b/live \n", " k1 \n")).toBe("rtmp://a.b/live/k1");
  });
  it("rejects non-rtmp urls, empty keys and inner spaces", () => {
    expect(() => joinRtmpUrl("https://x.y", "k")).toThrow(RtmpInputError);
    expect(() => joinRtmpUrl("rtmp://x.y", "  ")).toThrow(RtmpInputError);
    expect(() => joinRtmpUrl("rtmp://x.y", "a b")).toThrow(RtmpInputError);
  });
});

describe("redaction", () => {
  it("removes rtmp urls and explicit secrets from text", () => {
    const secret = "SuperSecretKey123";
    const msg = `failed to connect rtmps://live.example.com/rtmp/${secret}?x=1 (key ${secret})`;
    const out = redact(msg, [secret]);
    expect(out).not.toContain(secret);
    expect(out).not.toContain("live.example.com");
  });
  it("redacts key-looking fields", () => {
    expect(redact('{"streamKey":"abcdef123"}')).not.toContain("abcdef123");
  });
  it("redacts a whole key=value query string including the parts after &", () => {
    const out = redact("failed streamKey=abc?s_bl=1&s_psm=1&a=TOPSECRET9 end");
    expect(out).not.toContain("TOPSECRET9");
    expect(out).not.toContain("s_psm");
  });
  it("safeErrorMessage never leaks", () => {
    const e = new Error("bad url rtmps://h/x/SECRET99");
    expect(safeErrorMessage(e, ["SECRET99"])).not.toContain("SECRET99");
  });
});

describe("IST time helpers", () => {
  it("converts IST wall clock to UTC (+5:30)", () => {
    expect(istToUtc("2026-10-07", "00:00").toISOString()).toBe("2026-10-06T18:30:00.000Z");
    expect(istToUtc("2026-10-07", "14:00").toISOString()).toBe("2026-10-07T08:30:00.000Z");
  });
  it("round-trips", () => {
    const d = istToUtc("2026-12-31", "23:59");
    expect(istDateKey(d)).toBe("2026-12-31");
    expect(istParts(d)).toMatchObject({ hour: 23, minute: 59 });
  });
  it("IST date differs from UTC date late evening UTC", () => {
    expect(istDateKey(new Date("2026-10-07T20:00:00Z"))).toBe("2026-10-08");
  });
  it("calendar maths", () => {
    expect(addDaysToKey("2026-02-27", 2)).toBe("2026-03-01");
    expect(dowOfKey("2026-10-07")).toBe(3); // Wednesday
    expect(parseHHmm("09:05")).toBe(545);
    expect(() => parseHHmm("24:00")).toThrow();
  });
  it("formats durations", () => {
    expect(formatDuration(125)).toBe("2:05");
    expect(formatDuration(3725)).toBe("1:02:05");
    expect(formatDuration(-3)).toBe("0:00");
  });
});

describe("room metadata", () => {
  it("round-trips", () => {
    const m = { ...EMPTY_METADATA, onAirIdentity: "ravi", onAirName: "Ravi", transition: true };
    expect(parseRoomMetadata(serializeRoomMetadata(m))).toEqual(m);
  });
  it("garbage becomes the safe default (transition video), never a crash", () => {
    expect(parseRoomMetadata("{not json")).toEqual(EMPTY_METADATA);
    expect(parseRoomMetadata(undefined)).toEqual(EMPTY_METADATA);
    expect(parseRoomMetadata('{"onAirIdentity":42}').onAirIdentity).toBeNull();
  });
});
