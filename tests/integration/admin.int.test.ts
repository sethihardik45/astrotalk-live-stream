import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createSessionCookieValue } from "@/lib/auth";
import { db } from "@/lib/db";
import { __setClientsForTests } from "@/lib/livekit";
import { resetRateLimits } from "@/lib/ratelimit";
import { istDateKey, istToUtc, addDaysToKey } from "@/lib/time";
import { POST as createAstrologerRoute } from "@/app/api/ops/astrologers/route";
import { POST as regenerateRoute } from "@/app/api/ops/astrologers/[id]/regenerate/route";
import { POST as createShiftRoute } from "@/app/api/ops/shifts/route";
import { DELETE as deleteShiftRoute, PATCH as patchShiftRoute } from "@/app/api/ops/shifts/[id]/route";
import { POST as createTemplateRoute } from "@/app/api/ops/templates/route";
import { POST as expandRoute } from "@/app/api/ops/templates/expand/route";
import { POST as importRoute } from "@/app/api/ops/import/route";
import { GET as scheduleRoute } from "@/app/api/ops/schedule/route";
import { POST as tokenRoute } from "@/app/api/live/token/route";
import { POST as stateRoute } from "@/app/api/live/state/route";
import { POST as stopRoute } from "@/app/api/ops/stream/stop/route";
import { FakeEgress, fakeRoomService } from "./fakeEgress";
import { POST as skipRoute } from "@/app/api/ops/skip/route";
import { POST as loginRoute } from "@/app/api/ops/login/route";
import { blockShift } from "@/lib/stage";

const HOST = "app.example.test";
const cookie = `ops_session=${createSessionCookieValue({ sub: "ops", exp: Date.now() + 3_600_000 })}`;

function req(path: string, method: string, body?: unknown, opts: { auth?: boolean } = {}) {
  const headers: Record<string, string> = { host: HOST, origin: `https://${HOST}`, "content-type": "application/json" };
  if (opts.auth !== false) headers.cookie = cookie;
  return new Request(`https://${HOST}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
const stateReq = (slug: string, ip: string) =>
  new Request(`https://${HOST}/api/live/state`, { method: "POST", headers: { "x-forwarded-for": ip, "content-type": "application/json" }, body: JSON.stringify({ slug }) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const j = async (r: Response) => (await r.json()) as Record<string, any>;

beforeEach(async () => {
  resetRateLimits();
  await db.eventLog.deleteMany();
  await db.setting.deleteMany();
  await db.shift.deleteMany();
  await db.shiftTemplate.deleteMany();
  await db.astrologer.deleteMany();
  // removeParticipant (used when regenerating a link) is a no-op against the fake
  __setClientsForTests({ room: { ...fakeRoomService, removeParticipant: async () => {} }, egress: new FakeEgress() });
});
afterAll(async () => {
  __setClientsForTests(null);
  await db.$disconnect();
});

describe("ops routes are protected", () => {
  it("every mutation refuses requests with no login or from another website", async () => {
    expect((await createAstrologerRoute(req("/api/ops/astrologers", "POST", { name: "X" }, { auth: false }))).status).toBe(401);
    expect((await scheduleRoute(req("/api/ops/schedule", "GET", undefined, { auth: false }))).status).toBe(401);
    expect((await stopRoute(req("/api/ops/stream/stop", "POST", {}, { auth: false }))).status).toBe(401);
    const evil = new Request(`https://${HOST}/api/ops/astrologers`, { method: "POST", headers: { host: HOST, origin: "https://evil.example", cookie, "content-type": "application/json" }, body: JSON.stringify({ name: "X" }) });
    expect((await createAstrologerRoute(evil)).status).toBe(403);
    expect(await db.astrologer.count()).toBe(0);
  });

  it("rejects a tampered or expired session cookie", async () => {
    const good = createSessionCookieValue({ sub: "ops", exp: Date.now() + 100_000 });
    const [payload] = good.split(".");
    const forged = `${payload}.AAAA`;
    const expired = createSessionCookieValue({ sub: "ops", exp: Date.now() - 1000 });
    for (const c of [forged, expired]) {
      const r = new Request(`https://${HOST}/api/ops/schedule`, { headers: { host: HOST, cookie: `ops_session=${c}` } });
      expect((await scheduleRoute(r)).status).toBe(401);
    }
  });
});

describe("astrologer links", () => {
  it("regenerating a link kills the old one immediately and the new one works", async () => {
    const created = await j(await createAstrologerRoute(req("/api/ops/astrologers", "POST", { name: "Ravi", tagline: "Vedic" })));
    const oldSlug = (created.link as string).split("/live/")[1];
    expect(oldSlug.length).toBeGreaterThanOrEqual(24);

    // the old link is valid right now
    expect((await stateRoute(stateReq(oldSlug, "9.9.9.1"))).status).toBe(200);

    const regen = await j(await regenerateRoute(req(`/api/ops/astrologers/${created.id}/regenerate`, "POST", {}), ctx(created.id)));
    const newSlug = (regen.link as string).split("/live/")[1];
    expect(newSlug).not.toBe(oldSlug);

    const old = await stateRoute(stateReq(oldSlug, "9.9.9.2"));
    expect(old.status).toBe(404);
    const oldToken = await tokenRoute(new Request(`https://${HOST}/api/live/token`, { method: "POST", headers: { "x-forwarded-for": "9.9.9.3" }, body: JSON.stringify({ slug: oldSlug }) }));
    expect(oldToken.status).toBe(404);
    expect((await stateRoute(stateReq(newSlug, "9.9.9.4"))).status).toBe(200);
  });

  it("an unknown slug and a switched-off astrologer look exactly the same (no hints)", async () => {
    const created = await j(await createAstrologerRoute(req("/api/ops/astrologers", "POST", { name: "Off" })));
    const slug = (created.link as string).split("/live/")[1];
    await db.astrologer.update({ where: { id: created.id }, data: { active: false } });
    const a = await stateRoute(stateReq(slug, "8.8.8.1"));
    const b = await stateRoute(stateReq("z".repeat(32), "8.8.8.2"));
    expect(a.status).toBe(b.status);
    expect(await a.text()).toBe(await b.text());
  });
});

describe("token API enforces the schedule window", () => {
  async function astroWithShift(startOffsetMin: number, lenMin = 60) {
    const a = await db.astrologer.create({ data: { name: "Tok", slug: `slug${Math.random().toString(36).slice(2)}${"x".repeat(30)}`.slice(0, 40) } });
    const s = new Date(Date.now() + startOffsetMin * 60_000);
    await db.shift.create({ data: { astrologerId: a.id, startsAt: s, endsAt: new Date(s.getTime() + lenMin * 60_000) } });
    return a;
  }
  const askToken = async (slug: string, ip: string) => tokenRoute(new Request(`https://${HOST}/api/live/token`, { method: "POST", headers: { "x-forwarded-for": ip }, body: JSON.stringify({ slug }) }));

  it("refuses more than 10 minutes before the shift, allows the green room and on-air, refuses after it ends", async () => {
    const early = await astroWithShift(30);
    expect((await askToken(early.slug, "7.7.7.1")).status).toBe(403);

    await db.shift.deleteMany(); // the stage is shared: only one shift at a time in this test
    const greenRoom = await astroWithShift(5);
    expect((await askToken(greenRoom.slug, "7.7.7.2")).status).toBe(200);

    await db.shift.deleteMany();
    const onAir = await astroWithShift(-10, 60);
    const r = await askToken(onAir.slug, "7.7.7.3");
    expect(r.status).toBe(200);
    const body = await j(r);
    const claims = JSON.parse(Buffer.from(body.token.split(".")[1], "base64url").toString());
    expect(claims.video.canPublish).toBe(false); // the token itself can NEVER publish
    expect(claims.sub).toBe(onAir.id);
    // valid until the shift end (50 min away) plus 10 minutes
    const ttlMin = (claims.exp - claims.nbf) / 60;
    expect(ttlMin).toBeGreaterThan(59);
    expect(ttlMin).toBeLessThan(61);

    await db.shift.deleteMany();
    const over = await astroWithShift(-120, 60);
    expect((await askToken(over.slug, "7.7.7.4")).status).toBe(403);
  });

  it("is rate limited per address", async () => {
    const a = await astroWithShift(120);
    let last = 0;
    for (let i = 0; i < 35; i++) last = (await askToken(a.slug, "6.6.6.6")).status;
    expect(last).toBe(429);
  });
});

describe("shifts API", () => {
  it("creates, rejects overlaps with a friendly message, edits in place, and deletes", async () => {
    const a = await j(await createAstrologerRoute(req("/api/ops/astrologers", "POST", { name: "A" })));
    const b = await j(await createAstrologerRoute(req("/api/ops/astrologers", "POST", { name: "B" })));
    const day = addDaysToKey(istDateKey(new Date()), 3);
    const t = (hhmm: string) => istToUtc(day, hhmm).toISOString();

    const s1 = await j(await createShiftRoute(req("/api/ops/shifts", "POST", { astrologerId: a.id, startsAt: t("14:00"), endsAt: t("15:00") })));
    expect(s1.ok).toBe(true);

    const clash = await createShiftRoute(req("/api/ops/shifts", "POST", { astrologerId: b.id, startsAt: t("14:30"), endsAt: t("15:30") }));
    expect(clash.status).toBe(400);
    expect((await j(clash)).message).toMatch(/overlaps A/);

    const back2back = await createShiftRoute(req("/api/ops/shifts", "POST", { astrologerId: b.id, startsAt: t("15:00"), endsAt: t("16:00") }));
    expect(back2back.status).toBe(200);

    // shrink the first shift in place: must not clash with itself
    expect((await patchShiftRoute(req(`/api/ops/shifts/${s1.id}`, "PATCH", { endsAt: t("14:45") }), ctx(s1.id))).status).toBe(200);
    // extend it into B's shift: refused
    expect((await patchShiftRoute(req(`/api/ops/shifts/${s1.id}`, "PATCH", { endsAt: t("15:30") }), ctx(s1.id))).status).toBe(400);

    expect((await deleteShiftRoute(req(`/api/ops/shifts/${s1.id}`, "DELETE", {}), ctx(s1.id))).status).toBe(200);
    expect(await db.shift.count()).toBe(1);

    // bad input never reaches the database
    expect((await createShiftRoute(req("/api/ops/shifts", "POST", { astrologerId: a.id, startsAt: t("16:00"), endsAt: t("15:00") }))).status).toBe(400);
    expect((await createShiftRoute(req("/api/ops/shifts", "POST", { astrologerId: a.id, startsAt: "garbage", endsAt: t("15:00") }))).status).toBe(400);
  });
});

describe("recurring slots", () => {
  it("creates 14 days of shifts, never duplicates, and does not resurrect a shift ops deleted", async () => {
    const a = await j(await createAstrologerRoute(req("/api/ops/astrologers", "POST", { name: "R" })));
    const made = await j(await createTemplateRoute(req("/api/ops/templates", "POST", { astrologerId: a.id, startTimeLocal: "14:00", durationMinutes: 60, daysOfWeek: [0, 1, 2, 3, 4, 5, 6] })));
    expect(made.created).toBe(14);
    expect(await db.shift.count()).toBe(14);

    expect((await j(await expandRoute(req("/api/ops/templates/expand", "POST", {})))).created).toBe(0); // idempotent

    const victim = await db.shift.findFirstOrThrow({ orderBy: { startsAt: "asc" } });
    await deleteShiftRoute(req(`/api/ops/shifts/${victim.id}`, "DELETE", {}), ctx(victim.id));
    expect((await j(await expandRoute(req("/api/ops/templates/expand", "POST", {})))).created).toBe(0); // stays deleted
    expect(await db.shift.count()).toBe(13);

    // a manual edit survives re-expansion
    const edited = await db.shift.findFirstOrThrow({ orderBy: { startsAt: "asc" } });
    await patchShiftRoute(req(`/api/ops/shifts/${edited.id}`, "PATCH", { startsAt: new Date(edited.startsAt.getTime() + 15 * 60_000).toISOString(), endsAt: new Date(edited.endsAt.getTime() + 15 * 60_000).toISOString() }), ctx(edited.id));
    await expandRoute(req("/api/ops/templates/expand", "POST", {}));
    expect(await db.shift.count()).toBe(13);
    expect((await db.shift.findUniqueOrThrow({ where: { id: edited.id } })).startsAt.getTime()).toBe(edited.startsAt.getTime() + 15 * 60_000);
  });
});

describe("CSV import", () => {
  const day = () => addDaysToKey(istDateKey(new Date()), 5);

  it("preview saves nothing; import creates astrologers (with secret links) and shifts; bad rows are reported", async () => {
    const csv = `name,tagline,date,start_time,end_time\nNew Person,Tarot,${day()},10:00,11:00\nBad Row,,${day()},99:00,11:00\nNew Person,Tarot,${day()},11:00,12:00`;
    const preview = await j(await importRoute(req("/api/ops/import", "POST", { csv, commit: false })));
    expect(preview.committed).toBe(false);
    expect(preview.shiftsToCreate).toBe(2);
    expect(preview.errors).toHaveLength(1);
    expect(await db.astrologer.count()).toBe(0);
    expect(await db.shift.count()).toBe(0);

    const done = await j(await importRoute(req("/api/ops/import", "POST", { csv, commit: true })));
    expect(done.shiftsCreated).toBe(2);
    expect(await db.astrologer.count()).toBe(1);
    const created = await db.astrologer.findFirstOrThrow();
    expect(created.slug.length).toBeGreaterThanOrEqual(24);

    // running the same file again: the shifts now overlap what exists, so nothing is duplicated
    const again = await j(await importRoute(req("/api/ops/import", "POST", { csv, commit: true })));
    expect(again.shiftsCreated).toBe(0);
    expect(await db.shift.count()).toBe(2);
    expect(await db.astrologer.count()).toBe(1);
  });
});

describe("schedule snapshot", () => {
  it("reports coverage for the next 7 days and ignores shifts of switched-off astrologers", async () => {
    const a = await db.astrologer.create({ data: { name: "Full", slug: "f".repeat(32) } });
    const start = new Date();
    await db.shift.create({ data: { astrologerId: a.id, startsAt: new Date(start.getTime() - 3600_000), endsAt: new Date(start.getTime() + 7 * 86_400_000 + 3600_000) } });
    const full = await j(await scheduleRoute(req("/api/ops/schedule?days=7", "GET")));
    expect(full.coverageNext7Days.percent).toBe(100);

    await db.astrologer.update({ where: { id: a.id }, data: { active: false } });
    const off = await j(await scheduleRoute(req("/api/ops/schedule?days=7", "GET")));
    expect(off.coverageNext7Days.percent).toBe(0);
    expect(off.coverageNext7Days.gapCount).toBe(1);
  });
});

describe("skip to next", () => {
  const mk = async (name: string, startMin: number, endMin: number) => {
    const a = await db.astrologer.create({ data: { name, slug: name.padEnd(32, "s") } });
    const s = await db.shift.create({ data: { astrologerId: a.id, startsAt: new Date(Date.now() + startMin * 60_000), endsAt: new Date(Date.now() + endMin * 60_000) } });
    return { a, s };
  };

  it("ends the current shift now and starts the next one now", async () => {
    const cur = await mk("Cur", -10, 20);
    const nxt = await mk("Nxt", 20, 80);
    const res = await skipRoute(req("/api/ops/skip", "POST", {}));
    expect(res.status).toBe(200);
    const c = await db.shift.findUniqueOrThrow({ where: { id: cur.s.id } });
    const n = await db.shift.findUniqueOrThrow({ where: { id: nxt.s.id } });
    expect(c.endsAt.getTime()).toBe(n.startsAt.getTime()); // back to back, no gap, no overlap
    expect(n.startsAt.getTime()).toBeLessThan(Date.now() + 5000);
  });

  it("still works when the current shift was removed from stage (blocked shifts are not invisible to the database)", async () => {
    const cur = await mk("Cur", -10, 20);
    await mk("Nxt", 20, 80);
    await blockShift(cur.s.id);
    const res = await skipRoute(req("/api/ops/skip", "POST", {}));
    expect(res.status).toBe(200);
  });

  it("says something helpful (not a crash) if a switched-off astrologer's shift is in between", async () => {
    await mk("Cur", -10, 10);
    const off = await mk("Off", 10, 30);
    await db.astrologer.update({ where: { id: off.a.id }, data: { active: false } });
    await mk("Nxt", 30, 90);
    const res = await skipRoute(req("/api/ops/skip", "POST", {}));
    expect(res.status).toBe(400);
    expect((await j(res)).message).toMatch(/Schedule/);
  });
});

describe("login lockout", () => {
  const login = (password: string, ip: string) =>
    loginRoute(new Request(`https://${HOST}/api/ops/login`, { method: "POST", headers: { host: HOST, origin: `https://${HOST}`, "x-forwarded-for": ip, "content-type": "application/json" }, body: JSON.stringify({ password }) }));

  it("locks an address after 8 WRONG passwords, but successful logins never count", async () => {
    for (let i = 0; i < 20; i++) expect((await login("test-ops-password", "5.5.5.5")).status).toBe(200); // 20 good logins: fine
    for (let i = 0; i < 8; i++) expect((await login("wrong", "4.4.4.4")).status).toBe(401);
    expect((await login("wrong", "4.4.4.4")).status).toBe(429);
    expect((await login("test-ops-password", "4.4.4.4")).status).toBe(429); // even the right password waits
    expect((await login("test-ops-password", "5.5.5.5")).status).toBe(200); // other addresses are unaffected
  });
});
