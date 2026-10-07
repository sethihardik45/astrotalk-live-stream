import { createHash } from "node:crypto";
import { AccessToken } from "livekit-server-sdk";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { assertPublicLayoutUrl, canRestart, confirmSwitch, liveSessions, reconcileEgress, restartFailed, rotateStream, startStream, stopStreams, StreamError } from "@/lib/egressControl";
import { __setClientsForTests } from "@/lib/livekit";
import { POST as webhook } from "@/app/api/livekit/webhook/route";
import { FakeEgress, fakeRoomService } from "./fakeEgress";

const SERVER = "rtmps://live-upload.example.com:443/rtmp/";
const KEY1 = "KEYONE_abc123?s_bl=1&s_sc=SECRET_ONE";
const KEY2 = "KEYTWO_def456?s_bl=1&s_sc=SECRET_TWO";
const NEEDLES = ["KEYONE_abc123", "SECRET_ONE", "KEYTWO_def456", "SECRET_TWO", "live-upload.example.com"];

let egress: FakeEgress;
let logged: string[];

/** Every piece of text in the database. The stream key must never be in it. */
async function dumpDb() {
  return JSON.stringify({ s: await db.streamSession.findMany(), e: await db.eventLog.findMany(), set: await db.setting.findMany() });
}
const agedOut = (id: string) => db.streamSession.update({ where: { id }, data: { startedAt: new Date(Date.now() - 60_000) } });

beforeEach(async () => {
  await db.eventLog.deleteMany();
  await db.setting.deleteMany();
  await db.streamSession.deleteMany();
  egress = new FakeEgress();
  __setClientsForTests({ room: fakeRoomService, egress });
  // Capture everything printed to the console so we can prove no key was logged.
  logged = [];
  for (const m of ["log", "warn", "error", "info"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logged.push(a.map(String).join(" ")));
});
afterAll(async () => {
  __setClientsForTests(null);
  await db.$disconnect();
});

describe("starting a stream", () => {
  it("asks LiveKit for exactly the spec'd portrait H.264/AAC RTMP egress with our custom layout", async () => {
    await startStream({ serverUrl: SERVER, streamKey: KEY1, label: "Test", ip: "1.2.3.4" });
    const call = egress.started[0];
    expect(call.room).toBe("astrotalk-live");
    expect(call.urls).toEqual([`rtmps://live-upload.example.com:443/rtmp/${KEY1}`]); // exactly one slash
    expect(call.opts.customBaseUrl).toBe("https://app.example.test/egress-layout");
    const enc = call.opts.encodingOptions as Record<string, unknown>;
    expect(enc).toMatchObject({ width: 720, height: 1280, framerate: 30, videoBitrate: 3000, keyFrameInterval: 2, audioBitrate: 128 });
    expect(enc.videoCodec).toBe(2); // H264_MAIN
    expect(enc.audioCodec).toBe(2); // AAC
  });

  it("records a session but never stores the key or server URL anywhere", async () => {
    const s = await startStream({ serverUrl: SERVER, streamKey: KEY1, ip: "1.2.3.4" });
    expect(s.egressId).toBe("EG_fake1");
    expect(s.liveAt).toBeTruthy();
    const dump = await dumpDb();
    for (const n of NEEDLES) expect(dump).not.toContain(n);
  });

  it("refuses to start twice, and refuses non-rtmp addresses", async () => {
    await startStream({ serverUrl: SERVER, streamKey: KEY1, ip: null });
    await expect(startStream({ serverUrl: SERVER, streamKey: KEY2, ip: null })).rejects.toThrow(/already running/);
    await expect(startStream({ serverUrl: "https://x.y", streamKey: KEY2, ip: null })).rejects.toBeInstanceOf(StreamError);
  });

  it("a failed start leaks nothing: not in the error, the log, the event log or the console", async () => {
    egress.failStart = true;
    const err = await startStream({ serverUrl: SERVER, streamKey: KEY1, ip: null }).catch((e: Error) => e);
    expect((err as Error).message).not.toMatch(/KEYONE|SECRET_ONE|live-upload/);
    expect(await dumpDb()).not.toMatch(/KEYONE|SECRET_ONE|live-upload/);
    expect(logged.join("\n")).not.toMatch(/KEYONE|SECRET_ONE|live-upload/);
  });
});

describe("rotation (make-before-break)", () => {
  it("runs two egresses side by side, then stops only the OLD one on confirm", async () => {
    const first = await startStream({ serverUrl: SERVER, streamKey: KEY1, label: "old", ip: null });
    const second = await rotateStream({ serverUrl: SERVER, streamKey: KEY2, label: "new", ip: null });
    expect(await liveSessions()).toHaveLength(2);
    expect(egress.stopped).toEqual([]); // the old one is still running
    expect(second.liveAt).toBeNull(); // the 4-hour clock has not started for the new one yet
    expect(second.rotationGroup).toBeTruthy();

    await expect(rotateStream({ serverUrl: SERVER, streamKey: "x", ip: null })).rejects.toThrow(/already in progress/);

    const winner = await confirmSwitch();
    expect(winner.id).toBe(second.id);
    expect(egress.stopped).toEqual([first.egressId]);
    const live = await liveSessions();
    expect(live.map((s) => s.id)).toEqual([second.id]);
    expect((await db.streamSession.findUniqueOrThrow({ where: { id: second.id } })).liveAt).toBeTruthy(); // clock starts now
    expect((await db.streamSession.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("ended");
    for (const n of NEEDLES) expect(await dumpDb()).not.toContain(n);
  });

  it("rotate needs something live; confirm needs a rotation", async () => {
    await expect(rotateStream({ serverUrl: SERVER, streamKey: KEY1, ip: null })).rejects.toThrow(/No Instagram stream is live/);
    await startStream({ serverUrl: SERVER, streamKey: KEY1, ip: null });
    await expect(confirmSwitch()).rejects.toThrow(/no rotation/);
  });
});

describe("a stream dying unexpectedly", () => {
  it("raises the failure and retries ONCE with the same destination, then never loops", async () => {
    const s = await startStream({ serverUrl: SERVER, streamKey: KEY1, label: "main", ip: null });
    await agedOut(s.id);
    egress.kill(s.egressId!);
    await reconcileEgress({ force: true });

    expect((await db.streamSession.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("failed");
    expect(egress.started).toHaveLength(2); // original + exactly one automatic restart
    expect(egress.started[1].urls).toEqual(egress.started[0].urls); // same destination
    const live = await liveSessions();
    expect(live).toHaveLength(1);
    expect(live[0].liveAt?.getTime()).toBe((await db.streamSession.findUniqueOrThrow({ where: { id: s.id } })).liveAt?.getTime()); // age continues

    // the restarted stream dies too
    await agedOut(live[0].id);
    egress.kill(live[0].egressId!);
    await reconcileEgress({ force: true });
    expect(egress.started).toHaveLength(2); // NO second automatic retry
    expect(await liveSessions()).toHaveLength(0);

    const log = (await db.eventLog.findMany()).map((e) => e.message).join("\n");
    expect(log).toMatch(/ALERT/);
    expect(log).toMatch(/retry was already used/);
    for (const n of NEEDLES) expect(await dumpDb()).not.toContain(n);
    expect(logged.join("\n")).not.toMatch(/KEYONE|SECRET_ONE|live-upload/);
  });

  it("offers a manual one-click restart while the key is still held, once", async () => {
    const s = await startStream({ serverUrl: SERVER, streamKey: KEY1, ip: null });
    await agedOut(s.id);
    egress.kill(s.egressId!);
    await reconcileEgress({ force: true });
    const retry = (await liveSessions())[0];
    await agedOut(retry.id);
    egress.kill(retry.egressId!);
    await reconcileEgress({ force: true });

    expect(canRestart(retry.id)).toBe(true);
    const restarted = await restartFailed(retry.id, null);
    expect(restarted.status).not.toBe("failed");
    expect(canRestart(retry.id)).toBe(false); // used up
    await expect(restartFailed(retry.id, null)).rejects.toThrow();
  });

  it("does NOT conclude anything when LiveKit itself cannot be reached", async () => {
    const s = await startStream({ serverUrl: SERVER, streamKey: KEY1, ip: null });
    await agedOut(s.id);
    egress.listEgress = async () => {
      throw new Error("network down");
    };
    await reconcileEgress({ force: true });
    expect((await db.streamSession.findUniqueOrThrow({ where: { id: s.id } })).status).not.toBe("failed");
  });

  it("a stream ops stopped on purpose is 'ended', never an alert, never restarted", async () => {
    const s = await startStream({ serverUrl: SERVER, streamKey: KEY1, ip: null });
    await stopStreams(s.id);
    await reconcileEgress({ force: true });
    expect((await db.streamSession.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("ended");
    expect(egress.started).toHaveLength(1);
    expect(canRestart(s.id)).toBe(false); // key forgotten on stop
  });
});

describe("regressions found in review", () => {
  it("a stream that drops while LiveKit reports it as ENDING still raises the alert and the retry", async () => {
    const s = await startStream({ serverUrl: SERVER, streamKey: KEY1, ip: null });
    await agedOut(s.id);
    egress.ending.add(s.egressId!); // LiveKit: ACTIVE -> ENDING (the connection to Instagram dropped)
    await reconcileEgress({ force: true });
    expect((await db.streamSession.findUniqueOrThrow({ where: { id: s.id } })).status).not.toBe("ending"); // never confused with "ops pressed Stop"
    egress.kill(s.egressId!); // ... and then it leaves the active list
    await reconcileEgress({ force: true });
    expect((await db.streamSession.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("failed");
    expect(egress.started).toHaveLength(2); // the one automatic retry happened
  });

  it("confirm switch keeps the NEW stream even if the old one died and was auto-restarted in the meantime", async () => {
    const old = await startStream({ serverUrl: SERVER, streamKey: KEY1, label: "old", ip: null });
    const fresh = await rotateStream({ serverUrl: SERVER, streamKey: KEY2, label: "new", ip: null });
    await agedOut(old.id);
    egress.kill(old.egressId!);
    await reconcileEgress({ force: true }); // old dies, is restarted with the OLD key -> it is now the newest session
    expect(await liveSessions()).toHaveLength(2);
    const winner = await confirmSwitch();
    expect(winner.id).toBe(fresh.id);
    expect((await liveSessions()).map((x) => x.id)).toEqual([fresh.id]);
  });

  it("a Stop that LiveKit does not confirm is not reported as stopped, and the stream is not forgotten", async () => {
    const s = await startStream({ serverUrl: SERVER, streamKey: KEY1, ip: null });
    egress.stopError = "503 service unavailable";
    await expect(stopStreams(s.id)).rejects.toThrow(/did not confirm/);
    expect((await db.streamSession.findUniqueOrThrow({ where: { id: s.id } })).status).toBe(s.status); // unchanged: not "ending", not "ended"
    expect(await liveSessions()).toHaveLength(1);
    egress.stopError = null;
    await stopStreams(s.id);
    expect(await liveSessions()).toHaveLength(0);
  });

  it("refuses a Server URL that has the key pasted into it", async () => {
    await expect(startStream({ serverUrl: `${SERVER}${KEY1}`, streamKey: KEY2, ip: null })).rejects.toThrow(/includes the stream key/);
    expect(egress.started).toHaveLength(0);
  });
});

describe("LiveKit webhook endpoint", () => {
  const post = async (body: string, auth?: string) =>
    webhook(new Request("https://app.example.test/api/livekit/webhook", { method: "POST", body, headers: { "content-type": "application/webhook+json", ...(auth ? { authorization: auth } : {}) } }));

  // LiveKit signs a webhook with a JWT whose "sha256" claim is the hash of the body.
  async function signed(body: string, secret = "test-secret-test-secret-test-secret-1234") {
    const at = new AccessToken("APItestkey", secret);
    at.sha256 = createHash("sha256").update(body).digest("base64");
    return at.toJwt();
  }

  it("rejects unsigned, wrongly signed, and body-tampered requests", async () => {
    const body = JSON.stringify({ event: "egress_ended", egressInfo: { egressId: "EG_x" } });
    expect((await post(body)).status).toBe(401);
    expect((await post(body, await signed(body, "a-different-secret-a-different-secret-12345"))).status).toBe(401);
    expect((await post(body + " ", await signed(body))).status).toBe(401);
  });

  it("accepts a correctly signed event and triggers a status check", async () => {
    const s = await startStream({ serverUrl: SERVER, streamKey: KEY1, ip: null });
    await agedOut(s.id);
    egress.kill(s.egressId!);
    const body = JSON.stringify({ event: "egress_ended", id: "EV_1", createdAt: 1, egressInfo: { egressId: s.egressId, status: "EGRESS_FAILED" } });
    const res = await post(body, await signed(body));
    expect(res.status).toBe(200);
    expect((await db.streamSession.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("failed");
  });
});

describe("Instagram and YouTube at the same time", () => {
  const YT = "rtmp://a.rtmp.youtube.com/live2";
  const YT_KEY = "yt-key-AAAA-BBBB-CCCC";

  it("runs one independent stream per platform, both filming the same layout page", async () => {
    const ig = await startStream({ serverUrl: SERVER, streamKey: KEY1, platform: "instagram", ip: null });
    const yt = await startStream({ serverUrl: YT, streamKey: YT_KEY, platform: "youtube", ip: null });
    expect(ig.platform).toBe("instagram");
    expect(yt.platform).toBe("youtube");
    expect(egress.started).toHaveLength(2);
    expect(egress.started[0].opts.customBaseUrl).toBe(egress.started[1].opts.customBaseUrl); // same picture
    expect(egress.started[1].urls).toEqual([`${YT}/${YT_KEY}`]);
    expect(await liveSessions()).toHaveLength(2);
    expect(await liveSessions("youtube")).toHaveLength(1);
    // a second stream of the SAME platform is still refused
    await expect(startStream({ serverUrl: YT, streamKey: "other", platform: "youtube", ip: null })).rejects.toThrow(/YouTube stream is already running/);
    for (const n of [...NEEDLES, "yt-key-AAAA", YT_KEY]) expect(await dumpDb()).not.toContain(n);
  });

  it("rotating Instagram's key never touches YouTube", async () => {
    const ig = await startStream({ serverUrl: SERVER, streamKey: KEY1, platform: "instagram", ip: null });
    const yt = await startStream({ serverUrl: YT, streamKey: YT_KEY, platform: "youtube", ip: null });
    const fresh = await rotateStream({ serverUrl: SERVER, streamKey: KEY2, platform: "instagram", ip: null });
    expect(await liveSessions("youtube")).toHaveLength(1); // YouTube is not "rotating"
    expect(await liveSessions("instagram")).toHaveLength(2);
    const winner = await confirmSwitch("instagram");
    expect(winner.id).toBe(fresh.id);
    expect(egress.stopped).toEqual([ig.egressId]); // ONLY the old Instagram egress was stopped
    expect((await db.streamSession.findUniqueOrThrow({ where: { id: yt.id } })).status).not.toBe("ended");
  });

  it("a YouTube failure is handled on its own: Instagram keeps running and is not restarted", async () => {
    const ig = await startStream({ serverUrl: SERVER, streamKey: KEY1, platform: "instagram", ip: null });
    const yt = await startStream({ serverUrl: YT, streamKey: YT_KEY, platform: "youtube", ip: null });
    await agedOut(yt.id);
    egress.kill(yt.egressId!);
    await reconcileEgress({ force: true });
    expect((await db.streamSession.findUniqueOrThrow({ where: { id: yt.id } })).status).toBe("failed");
    const live = await liveSessions();
    expect(live.filter((x) => x.platform === "instagram").map((x) => x.id)).toEqual([ig.id]); // untouched
    expect(live.filter((x) => x.platform === "youtube")).toHaveLength(1); // its own single automatic retry
    expect(egress.started[2].urls).toEqual([`${YT}/${YT_KEY}`]); // retried with YouTube's destination, not Instagram's
    expect(egress.stopped).toEqual([]);
  });

  it("stopping one platform leaves the other running", async () => {
    const ig = await startStream({ serverUrl: SERVER, streamKey: KEY1, platform: "instagram", ip: null });
    const yt = await startStream({ serverUrl: YT, streamKey: YT_KEY, platform: "youtube", ip: null });
    await stopStreams(yt.id);
    expect((await liveSessions()).map((x) => x.id)).toEqual([ig.id]);
  });
});

describe("layout address check", () => {
  it("explains in plain words when the app address is not public https, before LiveKit is called", () => {
    for (const bad of ["http://localhost:3000/egress-layout", "https://localhost:3000/egress-layout", "http://app.example.com/egress-layout", "https://127.0.0.1/egress-layout", "not a url"]) {
      expect(() => assertPublicLayoutUrl(bad), bad).toThrow(StreamError);
    }
    expect(() => assertPublicLayoutUrl("http://localhost:3000/egress-layout")).toThrow(/tunnel/);
    expect(() => assertPublicLayoutUrl("https://random-words.trycloudflare.com/egress-layout")).not.toThrow();
  });
});
