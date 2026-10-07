import { randomUUID } from "node:crypto";
import { AudioCodec, EgressStatus, EncodingOptions, StreamOutput, StreamProtocol, VideoCodec, type EgressInfo } from "livekit-server-sdk";
import type { StreamSession, StreamStatus } from "@prisma/client";
import { db } from "./db";
import { env } from "./env";
import { logEvent } from "./events";
import { egressClient, ensureRoom, roomName } from "./livekit";
import { redact, safeErrorMessage } from "./redact";
import { joinRtmpUrl } from "./rtmp";

/**
 * Everything about the video stream that goes to Instagram: start, rotate, confirm switch, stop, and noticing when it dies.
 *
 * STREAM KEYS: the full destination (server URL + key) lives ONLY in the `held` map below — process memory, never the database,
 * never a log, never sent back to a browser. We keep it while a stream is running so we can do ONE automatic restart if
 * the stream drops. It is deleted when the stream is stopped, switched away from, restarted, or after 2 hours.
 * Consequence: this requires a single web server process (which is how docker-compose.yml runs it).
 */

interface Held {
  url: string; // SECRET: rtmps://.../<key>
  secrets: string[]; // SECRET: url + the key itself + its first part, used only to scrub error messages
  label: string;
  /** True once we have used our one automatic restart for this chain of streams. */
  retryUsed: boolean;
  heldAt: number;
}
const g = globalThis as unknown as { __held?: Map<string, Held>; __egressLock?: Promise<unknown>; __lastReconcile?: number };
const held = (g.__held ??= new Map<string, Held>());

// Longer than Instagram's 4-hour limit, so the one automatic retry works for the whole life of a stream.
const HOLD_MAX_MS = 6 * 3600_000;

/** What we ask LiveKit to produce. All of this is "portrait 9:16 for Instagram Live". */
export function encodingOptions() {
  return new EncodingOptions({
    width: 720,
    height: 1280,
    depth: 24,
    framerate: 30,
    videoCodec: VideoCodec.H264_MAIN,
    videoBitrate: 3000, // kbps
    keyFrameInterval: 2, // seconds. Instagram wants a keyframe at least every 2 s.
    audioCodec: AudioCodec.AAC,
    audioBitrate: 128, // kbps
    audioFrequency: 44100,
  });
}

/** The page LiveKit's egress opens in its hidden browser. It must be reachable from the internet. */
export function layoutUrl(): string {
  return `${env().NEXT_PUBLIC_APP_URL.replace(/\/+$/, "")}/egress-layout`;
}

export function mapStatus(s: EgressStatus): StreamStatus {
  switch (s) {
    case EgressStatus.EGRESS_STARTING:
      return "starting";
    case EgressStatus.EGRESS_ACTIVE:
      return "active";
    case EgressStatus.EGRESS_ENDING:
      return "ending";
    case EgressStatus.EGRESS_COMPLETE:
      return "ended";
    default:
      return "failed"; // FAILED, ABORTED, LIMIT_REACHED
  }
}

const LIVE_STATES: StreamStatus[] = ["starting", "active", "ending"];

/** Each platform gets its OWN stream (own egress, key, timer, alerts, rotation). Both film the same layout page, so the picture is identical. */
export const PLATFORMS = ["instagram", "youtube", "other"] as const;
export type Platform = (typeof PLATFORMS)[number];
export const PLATFORM_NAMES: Record<Platform, string> = { instagram: "Instagram", youtube: "YouTube", other: "Other" };

export class StreamError extends Error {}

/** One-at-a-time guard so a webhook and a page refresh can never both "handle" the same failure. */
async function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const prev = g.__egressLock ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  g.__egressLock = next.catch(() => {});
  return next;
}

/** Every string that must never appear in logs/errors for this destination. */
function secretsOf(url: string): string[] {
  const key = url.replace(/^rtmps?:\/\/[^/]+\/?(?:[^/]*\/)*/i, "");
  return [url, key, key.split("?")[0]].filter((x) => x.length >= 6);
}

/** LiveKit's servers open our layout page over the internet, so it must be a public https address (not localhost). */
export function assertPublicLayoutUrl(address = layoutUrl()) {
  let u: URL;
  try {
    u = new URL(address);
  } catch {
    throw new StreamError("NEXT_PUBLIC_APP_URL in the .env file is not a valid web address.");
  }
  const local = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(u.hostname) || u.hostname.endsWith(".local");
  if (u.protocol !== "https:" || local) {
    throw new StreamError(
      `LiveKit cannot open ${u.origin} because it is not a public https address (it is only reachable from this computer). ` +
        "Start a tunnel (README section 4, step 7), put its https address into NEXT_PUBLIC_APP_URL in .env, then restart the website and the worker.",
    );
  }
}

async function launch(args: { url: string; label: string; platform: Platform; rotationGroup: string | null; ip: string | null; retryUsed: boolean; liveAt: Date | null }): Promise<StreamSession> {
  assertPublicLayoutUrl();
  await ensureRoom();
  const info = await egressClient().startRoomCompositeEgress(
    roomName(),
    new StreamOutput({ protocol: StreamProtocol.RTMP, urls: [args.url] }),
    { customBaseUrl: layoutUrl(), encodingOptions: encodingOptions() },
  );
  const session = await db.streamSession.create({
    data: {
      label: args.label,
      platform: args.platform,
      egressId: info.egressId,
      status: mapStatus(info.status) === "failed" ? "starting" : mapStatus(info.status),
      rotationGroup: args.rotationGroup,
      createdByIp: args.ip,
      liveAt: args.liveAt,
    },
  });
  held.set(session.id, { url: args.url, secrets: secretsOf(args.url), label: args.label, retryUsed: args.retryUsed, heldAt: Date.now() });
  return session;
}

export async function liveSessions(platform?: Platform) {
  return db.streamSession.findMany({ where: { status: { in: LIVE_STATES }, ...(platform ? { platform } : {}) }, orderBy: { startedAt: "asc" } });
}

function validateDestination(serverUrl: string, streamKey: string): string {
  if (serverUrl.includes("?")) throw new StreamError("The Server URL looks like it includes the stream key. Paste only the Server URL here, and the key in the Stream key box.");
  try {
    return joinRtmpUrl(serverUrl, streamKey);
  } catch (e) {
    throw new StreamError(e instanceof Error ? e.message : "Invalid server URL or stream key");
  }
}

/** Start the first stream (nothing is live yet). */
export async function startStream(input: { serverUrl: string; streamKey: string; label?: string; platform?: Platform; ip: string | null }) {
  const platform = input.platform ?? "instagram";
  const url = validateDestination(input.serverUrl, input.streamKey);
  const secrets = [url, input.streamKey, input.serverUrl];
  return serialized(async () => {
    if ((await liveSessions(platform)).length > 0) throw new StreamError(`A ${PLATFORM_NAMES[platform]} stream is already running. Use “Rotate stream key” to switch to a new key.`);
    try {
      const label = input.label?.trim() || `${PLATFORM_NAMES[platform]} stream`;
      const s = await launch({ url, label, platform, rotationGroup: null, ip: input.ip, retryUsed: false, liveAt: new Date() });
      await logEvent("egress", `${PLATFORM_NAMES[platform]} stream “${label}” started`);
      return s;
    } catch (e) {
      const msg = safeErrorMessage(e, secrets);
      await logEvent("egress", `Could not start ${PLATFORM_NAMES[platform]} stream: ${msg}`);
      throw new StreamError(`LiveKit could not start the stream: ${msg}`);
    }
  });
}

/** Make-before-break rotation: start a SECOND egress to the new key while the old one keeps running. */
export async function rotateStream(input: { serverUrl: string; streamKey: string; label?: string; platform?: Platform; ip: string | null }) {
  const platform = input.platform ?? "instagram";
  const url = validateDestination(input.serverUrl, input.streamKey);
  const secrets = [url, input.streamKey, input.serverUrl];
  return serialized(async () => {
    const live = await liveSessions(platform);
    if (live.length === 0) throw new StreamError(`No ${PLATFORM_NAMES[platform]} stream is live right now. Use “Start stream” instead.`);
    if (live.length >= 2) throw new StreamError("A rotation is already in progress. Finish it with “Confirm switch” first.");
    try {
      const group = live[0].rotationGroup ?? randomUUID();
      if (!live[0].rotationGroup) await db.streamSession.update({ where: { id: live[0].id }, data: { rotationGroup: group } });
      const label = input.label?.trim() || `New ${PLATFORM_NAMES[platform]} stream`;
      const s = await launch({ url, label, platform, rotationGroup: group, ip: input.ip, retryUsed: false, liveAt: null });
      await logEvent("rotation", `${PLATFORM_NAMES[platform]} rotation started: new stream “${label}” is running next to the old one`);
      return s;
    } catch (e) {
      const msg = safeErrorMessage(e, secrets);
      await logEvent("rotation", `${PLATFORM_NAMES[platform]} rotation could not start: ${msg}`);
      throw new StreamError(`LiveKit could not start the new stream: ${msg}`);
    }
  });
}

async function stopOne(s: StreamSession) {
  await db.streamSession.updateMany({ where: { id: s.id, status: { in: LIVE_STATES } }, data: { status: "ending" } });
  try {
    if (s.egressId) await egressClient().stopEgress(s.egressId);
  } catch (e) {
    const msg = safeErrorMessage(e);
    // "already ended / not found" means it is stopped, which is what we wanted.
    if (!/not found|already|complete|ended/i.test(msg)) {
      // Anything else: LiveKit may STILL be streaming. Do not claim it stopped and do not forget the stream.
      await db.streamSession.updateMany({ where: { id: s.id, status: "ending" }, data: { status: s.status } });
      await logEvent("egress", `Could not stop “${s.label}”: ${msg}`);
      throw new StreamError(`LiveKit did not confirm that “${s.label}” stopped (${msg}). Please try again.`);
    }
  }
  held.delete(s.id);
  await db.streamSession.update({ where: { id: s.id }, data: { status: "ended", endedAt: new Date() } });
}

/** Step 3 of a rotation: the new live is on Instagram, so stop the OLD egress(es). */
export async function confirmSwitch(platform: Platform = "instagram") {
  return serialized(async () => {
    const live = await liveSessions(platform);
    if (live.length < 2) throw new StreamError("There is no rotation in progress. (If the new stream stopped, start it again with “Start new stream”.)");
    // The NEW stream is the one still in preview (no liveAt). An automatic restart of the OLD stream is newer by start time but keeps
    // the old stream's liveAt, so "newest" would pick the wrong one.
    const preview = live.filter((s) => s.liveAt === null);
    const newest = preview.length === 1 ? preview[0] : live[live.length - 1];
    if (newest.status === "ending") throw new StreamError("The new stream is stopping. Please check it and start it again.");
    const old = live.filter((s) => s.id !== newest.id);
    for (const s of old) await stopOne(s);
    await db.streamSession.update({ where: { id: newest.id }, data: { liveAt: new Date() } });
    await logEvent("rotation", `${PLATFORM_NAMES[platform]} switch confirmed: old stream stopped, “${newest.label}” is now the live stream`);
    return newest;
  });
}

/** Stop one stream, or all of them. */
export async function stopStreams(sessionId?: string) {
  return serialized(async () => {
    const live = (await liveSessions()).filter((s) => !sessionId || s.id === sessionId);
    if (live.length === 0) throw new StreamError("That stream is not running.");
    for (const s of live) {
      await stopOne(s);
      await logEvent("egress", `Stream “${s.label}” stopped by ops`);
    }
  });
}

/** One-click restart of a failed stream using the destination still held in memory, if any. */
export async function restartFailed(sessionId: string, ip: string | null) {
  return serialized(async () => {
    const failed = await db.streamSession.findUnique({ where: { id: sessionId } });
    if (!failed || failed.status !== "failed") throw new StreamError("That stream has not failed.");
    const h = held.get(sessionId);
    if (!h) throw new StreamError("For safety the stream key is not kept. Please paste a new key and press Start.");
    const platform = failed.platform as Platform;
    if ((await liveSessions(platform)).length > 0) throw new StreamError(`A ${PLATFORM_NAMES[platform]} stream is already running.`);
    held.delete(sessionId);
    try {
      const s = await launch({ url: h.url, label: h.label, platform, rotationGroup: null, ip, retryUsed: true, liveAt: failed.liveAt ?? new Date() });
      await logEvent("egress", `Stream “${h.label}” restarted by ops`);
      return s;
    } catch (e) {
      held.set(sessionId, h); // keep it so ops can try again
      const msg = safeErrorMessage(e, h.secrets);
      await logEvent("egress", `Restart failed: ${msg}`);
      throw new StreamError(`LiveKit could not restart the stream: ${msg}`);
    }
  });
}

export function canRestart(sessionId: string): boolean {
  return held.has(sessionId);
}

// ------------------------------------------------------------------------------------------------
// Noticing what LiveKit says (called from the webhook AND from the ops page refresh, so it works even
// if the webhook is not set up yet)
// ------------------------------------------------------------------------------------------------

function purgeOldHolds() {
  const now = Date.now();
  for (const [id, h] of held) if (now - h.heldAt > HOLD_MAX_MS) held.delete(id);
}

function failureText(info: EgressInfo | undefined): string {
  const raw = [info?.error, info?.details, ...(info?.streamResults ?? []).map((r) => r.error)].filter(Boolean).join(" · ");
  return redact(raw || "The stream ended without being stopped.", [...held.values()].flatMap((h) => h.secrets)).slice(0, 300);
}

/** Compare our database to LiveKit's list of running egresses; fix statuses; react to unexpected endings. */
export async function reconcileEgress(opts: { force?: boolean } = {}): Promise<void> {
  const now = Date.now();
  if (!opts.force && g.__lastReconcile && now - g.__lastReconcile < 2500) return;
  g.__lastReconcile = now;
  purgeOldHolds();

  await serialized(async () => {
    const mine = await liveSessions();
    if (mine.length === 0) return;

    let active: EgressInfo[];
    try {
      active = await egressClient().listEgress({ roomName: roomName(), active: true });
    } catch {
      return; // LiveKit unreachable: do NOT conclude anything from that
    }
    const byId = new Map(active.map((a) => [a.egressId, a]));

    for (const s of mine) {
      if (!s.egressId) continue;
      const info = byId.get(s.egressId);
      if (info) {
        // NOTE: LiveKit saying "ending" is deliberately NOT saved. In our database "ending" means "ops pressed Stop", and mixing the
        // two would hide a stream that dropped on its own (no alert, no retry).
        const status = mapStatus(info.status);
        if (status !== s.status && status !== "failed" && status !== "ended" && status !== "ending") {
          await db.streamSession.update({ where: { id: s.id }, data: { status } });
        }
        continue;
      }
      // Not in LiveKit's active list. Give brand-new sessions a moment (list may lag), then find out what happened.
      if (now - s.startedAt.getTime() < 15_000) continue;

      let finalInfo: EgressInfo | undefined;
      try {
        finalInfo = (await egressClient().listEgress({ egressId: s.egressId }))[0];
      } catch {
        continue;
      }
      if (s.status === "ending") {
        await db.streamSession.update({ where: { id: s.id }, data: { status: "ended", endedAt: new Date() } });
        continue;
      }
      await handleUnexpectedEnd(s, finalInfo);
    }
  });
}

async function handleUnexpectedEnd(s: StreamSession, info: EgressInfo | undefined) {
  const reason = failureText(info);
  const claimed = await db.streamSession.updateMany({
    where: { id: s.id, status: { in: ["starting", "active"] } },
    data: { status: "failed", endedAt: new Date(), failureReason: reason },
  });
  if (claimed.count !== 1) return; // someone else already handled it
  await logEvent("egress", `ALERT: ${PLATFORM_NAMES[s.platform as Platform] ?? s.platform} stream “${s.label}” stopped unexpectedly. ${reason}`);

  const h = held.get(s.id);
  if (!h) {
    await logEvent("egress", "Not restarting automatically: the stream key is no longer held in memory. Paste a new key to restart.");
    return;
  }
  if (h.retryUsed) {
    await logEvent("egress", "Not restarting automatically: the one automatic retry was already used. Please restart manually.");
    return;
  }
  // The single automatic retry, with the same destination. It marks the new chain as "retry used" so it can never loop.
  held.delete(s.id);
  try {
    const fresh = await launch({ url: h.url, label: h.label, platform: s.platform as Platform, rotationGroup: s.rotationGroup, ip: s.createdByIp, retryUsed: true, liveAt: s.liveAt });
    await logEvent("egress", `Automatic restart of “${h.label}” started (${fresh.id.slice(-6)})`);
  } catch (e) {
    held.set(s.id, h); // keep it available for the manual one-click restart
    await logEvent("egress", `Automatic restart failed: ${safeErrorMessage(e, h.secrets)}`);
  }
}

/** Safe description of a session for the ops UI (no destinations, no keys). */
export function describeSession(s: StreamSession) {
  return {
    id: s.id,
    label: s.label,
    platform: s.platform as Platform,
    status: s.status,
    startedAt: s.startedAt.toISOString(),
    liveAt: s.liveAt ? s.liveAt.toISOString() : null,
    endedAt: s.endedAt ? s.endedAt.toISOString() : null,
    rotationGroup: s.rotationGroup,
    failureReason: s.failureReason,
    canRestart: s.status === "failed" && canRestart(s.id),
  };
}
