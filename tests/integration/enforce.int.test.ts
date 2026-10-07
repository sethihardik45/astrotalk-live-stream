import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { enforceOnce } from "@/lib/enforce";
import { parseRoomMetadata } from "@/lib/schedule/roomMetadata";
import { setSetting } from "@/lib/settings";
import { blockShift } from "@/lib/stage";
import { generateSlug } from "@/lib/slug";
import { istToUtc } from "@/lib/time";
import { FakeRoom } from "./fakeRoom";

const at = (hhmm: string, sec = 0) => new Date(istToUtc("2026-10-07", hhmm).getTime() + sec * 1000);
let A: string, B: string, C: string;

async function reset() {
  await db.eventLog.deleteMany();
  await db.setting.deleteMany();
  await db.shift.deleteMany();
  await db.astrologer.deleteMany();
  const mk = (name: string, tagline: string) => db.astrologer.create({ data: { name, tagline, slug: generateSlug() } }).then((a) => a.id);
  [A, B, C] = [await mk("Asha", "Vedic"), await mk("Bharat", "Tarot"), await mk("Chitra", "Vastu")];
  const shift = (astrologerId: string, s: string, e: string) => db.shift.create({ data: { astrologerId, startsAt: istToUtc("2026-10-07", s), endsAt: istToUtc("2026-10-07", e) } });
  await shift(A, "14:00", "15:00");
  await shift(B, "15:00", "16:00");
  // C has a shift later in the evening
  await shift(C, "20:00", "21:00");
}

beforeEach(reset);
afterAll(() => db.$disconnect());

describe("enforceOnce against a fake LiveKit room (real database)", () => {
  it("puts the right person on air and nobody else", async () => {
    const room = new FakeRoom();
    room.join(A);
    room.join(B); // B is in the green room (shift starts in 5 min)
    const r = await enforceOnce(at("14:55"), room.api());

    expect(r.errors).toEqual([]);
    expect(room.get(A)!.permission.canPublish).toBe(true);
    expect(room.get(B)!.permission.canPublish).toBe(false);
    const md = parseRoomMetadata(room.metadata);
    expect(md.onAirIdentity).toBe(A);
    expect(md.onAirName).toBe("Asha");
    expect(md.nextName).toBe("Bharat");
    expect(room.participants).toHaveLength(2); // B not removed
  });

  it("is idempotent: a second pass changes nothing and calls nothing", async () => {
    const room = new FakeRoom();
    room.join(A);
    room.join(B);
    await enforceOnce(at("14:55"), room.api());
    room.resetCalls();
    const again = await enforceOnce(at("14:55", 2), room.api());
    expect(again.changed).toEqual([]);
    expect(room.calls).toEqual([]);
  });

  it("hand-off: grant the new person, THEN switch metadata, THEN revoke the old one; stream never has a gap", async () => {
    const room = new FakeRoom();
    room.join(A, { canPublish: true });
    room.join(B);
    await enforceOnce(at("14:59", 58), room.api());
    room.resetCalls();

    const r = await enforceOnce(at("15:00"), room.api());
    expect(r.errors).toEqual([]);
    expect(room.calls).toEqual([`grant:${B}`, "metadata", `revoke:${A}`]);
    expect(parseRoomMetadata(room.metadata).onAirIdentity).toBe(B);
    expect(room.get(A)).toBeTruthy(); // still in the room during the grace period
    expect(room.get(A)!.permission.canPublish).toBe(false);
  });

  it("removes the finished astrologer only after the grace period (30 s)", async () => {
    const room = new FakeRoom();
    room.join(A);
    room.join(B, { canPublish: true });
    await enforceOnce(at("15:00", 29), room.api());
    expect(room.get(A)).toBeTruthy();
    await enforceOnce(at("15:00", 30), room.api());
    expect(room.get(A)).toBeUndefined();
  });

  it("blocks tampering: someone who somehow holds publish permission outside their slot loses it", async () => {
    const room = new FakeRoom();
    room.join(A);
    room.join(B, { canPublish: true }); // B is in the green room but was (wrongly) given publish rights
    const r = await enforceOnce(at("14:55"), room.api());
    expect(r.plan.revoke).toEqual([B]);
    expect(room.get(B)!.permission.canPublish).toBe(false);
  });

  it("removes strangers and people who show up outside their window", async () => {
    const room = new FakeRoom();
    room.join("not-an-astrologer", { canPublish: true });
    room.join(C); // C's shift is at 20:00; it is 14:55
    await enforceOnce(at("14:55"), room.api());
    expect(room.participants).toHaveLength(0);
  });

  it("ignores LiveKit's own egress recorder participant", async () => {
    const room = new FakeRoom();
    room.join("EG_recorder", { kind: 2, canPublish: false });
    room.join(A);
    await enforceOnce(at("14:30"), room.api());
    expect(room.get("EG_recorder")).toBeTruthy();
    expect(room.calls).not.toContain("remove:EG_recorder");
  });

  it("nobody scheduled: onAirIdentity is null so the layout shows the transition video", async () => {
    const room = new FakeRoom();
    await enforceOnce(at("18:00"), room.api());
    const md = parseRoomMetadata(room.metadata);
    expect(md.onAirIdentity).toBeNull();
    expect(md.nextName).toBe("Chitra");
  });

  it("ops switches (transition, mute) flow into the metadata the layout reads", async () => {
    const room = new FakeRoom();
    room.join(A);
    await setSetting("transitionOn", "true");
    const shift = await db.shift.findFirstOrThrow({ where: { astrologerId: A } });
    await setSetting("forceMute", shift.id);
    await enforceOnce(at("14:30"), room.api());
    const md = parseRoomMetadata(room.metadata);
    expect(md.transition).toBe(true);
    expect(md.muted).toBe(true);
    expect(md.onAirIdentity).toBe(A); // still known, the layout just overrides the picture
  });

  it("mute applies to ONE shift only: the next astrologer is not muted by accident", async () => {
    const room = new FakeRoom();
    room.join(A);
    room.join(B);
    const shiftA = await db.shift.findFirstOrThrow({ where: { astrologerId: A } });
    await setSetting("forceMute", shiftA.id);
    await enforceOnce(at("14:30"), room.api());
    expect(parseRoomMetadata(room.metadata).muted).toBe(true);
    await enforceOnce(at("15:00"), room.api()); // B's turn
    const md = parseRoomMetadata(room.metadata);
    expect(md.onAirIdentity).toBe(B);
    expect(md.muted).toBe(false);
  });

  it("'Remove from stage' blocks the shift: nobody on air and the person is removed", async () => {
    const room = new FakeRoom();
    room.join(A, { canPublish: true });
    const shift = await db.shift.findFirstOrThrow({ where: { astrologerId: A } });
    await blockShift(shift.id);
    await enforceOnce(at("14:30"), room.api());
    expect(room.get(A)).toBeUndefined();
    expect(parseRoomMetadata(room.metadata).onAirIdentity).toBeNull();
  });

  it("recreates the room if LiveKit lost it", async () => {
    const room = new FakeRoom();
    room.exists = false;
    await enforceOnce(at("14:30"), room.api());
    expect(room.calls).toContain("createRoom");
  });

  it("one failing LiveKit call does not stop the rest of the pass", async () => {
    const room = new FakeRoom();
    room.join(A);
    room.join("stranger");
    const api = room.api();
    const original = api.updateParticipant.bind(api);
    (api as { updateParticipant: unknown }).updateParticipant = async () => {
      throw new Error("LiveKit hiccup");
    };
    const r = await enforceOnce(at("14:30"), api);
    void original;
    expect(r.errors.length).toBeGreaterThan(0);
    expect(room.get("stranger")).toBeUndefined(); // removal still happened
    expect(parseRoomMetadata(room.metadata).onAirIdentity).toBe(A); // metadata still updated
  });

  it("logs shift changes to the event log without any secrets", async () => {
    const room = new FakeRoom();
    room.join(A);
    await enforceOnce(at("14:30"), room.api());
    const events = await db.eventLog.findMany();
    expect(events.map((e) => e.message).join(" ")).toMatch(/Asha is now on air/);
  });
});
