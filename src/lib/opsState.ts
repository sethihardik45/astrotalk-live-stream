import { ParticipantInfo_Kind } from "@livekit/protocol";
import { TrackSource, TrackType } from "livekit-server-sdk";
import type { EgressInfo } from "livekit-server-sdk";
import { db } from "./db";
import { canRestart, describeSession, liveSessions, reconcileEgress } from "./egressControl";
import { recentEvents } from "./events";
import { getHeartbeat } from "./heartbeats";
import { egressClient, roomName, roomService } from "./livekit";
import { safeErrorMessage } from "./redact";
import { computeSchedule } from "./schedule/onAir";
import type { ShiftLike } from "./schedule/types";
import { parseRoomMetadata } from "./schedule/roomMetadata";
import { getSetting, loadSettings } from "./settings";
import { getBlockedShiftIds } from "./stage";

/**
 * One read-only snapshot of everything the ops dashboard shows. Polled every 2 seconds, so the expensive part (asking LiveKit)
 * is cached for 1.5 seconds: ten open ops tabs cost the same as one.
 */
let cache: { at: number; value: OpsSnapshot } | null = null;

/** The shape the ops dashboard receives. (Imported as a TYPE by the browser code, so no server code is bundled.) */
export type OpsSnapshot = Awaited<ReturnType<typeof build>>;

export async function getOpsSnapshot(): Promise<OpsSnapshot> {
  if (cache && Date.now() - cache.at < 1500) return cache.value;
  const value = await build();
  cache = { at: Date.now(), value };
  return value;
}

async function build() {
  const now = new Date();
  await reconcileEgress().catch(() => {}); // notices dead streams even if webhooks are not set up

  const settings = await loadSettings();
  const [astrologers, blocked, shifts, sessions, events, workerBeat, workerError, dismissed] = await Promise.all([
    db.astrologer.findMany({ select: { id: true, name: true, tagline: true, active: true } }),
    getBlockedShiftIds(),
    db.shift.findMany({ where: { endsAt: { gt: new Date(now.getTime() - 60_000) }, startsAt: { lt: new Date(now.getTime() + 12 * 3_600_000) } }, orderBy: { startsAt: "asc" } }),
    db.streamSession.findMany({ orderBy: { startedAt: "desc" }, take: 6 }),
    recentEvents(100),
    getSetting("workerHeartbeat"),
    getSetting("workerError"),
    getSetting("streamAlertDismissed"),
  ]);
  const byId = new Map(astrologers.map((a) => [a.id, a]));

  // ---- LiveKit: who is in the room, egress status
  let room: {
    reachable: boolean;
    error: string | null;
    participants: Array<{ identity: string; name: string; canPublish: boolean; tracks: Array<{ kind: string; muted: boolean; width: number; height: number; mime: string }> }>;
    metadata: ReturnType<typeof parseRoomMetadata> | null;
    recorders: number;
  } = { reachable: true, error: null, participants: [], metadata: null, recorders: 0 };
  let egressInfos: EgressInfo[] = [];
  try {
    const [people, rooms, egress] = await Promise.all([
      roomService().listParticipants(roomName()),
      roomService().listRooms([roomName()]),
      egressClient().listEgress({ roomName: roomName(), active: true }),
    ]);
    egressInfos = egress;
    room.metadata = rooms[0] ? parseRoomMetadata(rooms[0].metadata) : null;
    room.recorders = people.filter((p) => p.kind === ParticipantInfo_Kind.EGRESS).length;
    room.participants = people
      .filter((p) => p.kind === ParticipantInfo_Kind.STANDARD)
      .map((p) => ({
        identity: p.identity,
        name: byId.get(p.identity)?.name ?? p.name ?? p.identity,
        canPublish: !!p.permission?.canPublish,
        tracks: p.tracks
          .filter((t) => t.source === TrackSource.CAMERA || t.source === TrackSource.MICROPHONE)
          .map((t) => ({ kind: t.type === TrackType.VIDEO ? "video" : "audio", muted: t.muted, width: t.width, height: t.height, mime: t.mimeType })),
      }));
  } catch (e) {
    room = { ...room, reachable: false, error: safeErrorMessage(e) };
  }
  const connected = new Set(room.participants.map((p) => p.identity));

  // ---- schedule
  const usable = shifts.filter((s) => !blocked.has(s.id) && byId.get(s.astrologerId)?.active);
  const view = computeSchedule(usable, now, settings.leadMs);
  const who = (id: string) => byId.get(id)?.name ?? "Unknown";
  const shape = (s: ShiftLike) => ({
    shiftId: s.id,
    astrologerId: s.astrologerId,
    name: who(s.astrologerId),
    tagline: byId.get(s.astrologerId)?.tagline ?? null,
    startsAt: s.startsAt.toISOString(),
    endsAt: s.endsAt.toISOString(),
    connected: connected.has(s.astrologerId),
  });
  const onAir = view.onAir ? shape(view.onAir) : null;
  const hb = view.onAir ? getHeartbeat(view.onAir.astrologerId) : null;
  const onAirParticipant = view.onAir ? room.participants.find((p) => p.identity === view.onAir!.astrologerId) : undefined;

  // ---- streams
  const live = await liveSessions();
  const liveIds = new Set(live.map((s) => s.id));
  const egressById = new Map(egressInfos.map((e) => [e.egressId, e]));
  const streams = sessions
    .filter((s) => liveIds.has(s.id))
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime()) // oldest (the one being replaced) first
    .map((s) => {
      const info = s.egressId ? egressById.get(s.egressId) : undefined;
      const stream = info?.streamResults?.[0];
      return {
        ...describeSession(s),
        livekitStatus: info ? ["starting", "active", "ending", "complete", "failed", "aborted", "limit"][info.status] ?? "unknown" : "unknown",
        streamRetries: stream?.retries ?? 0,
        streamError: stream?.error ? safeErrorMessage(stream.error) : null,
      };
    });
  // The alert: the newest stream failed and nothing is live now
  const newest = sessions[0];
  const alert =
    live.length === 0 && newest && newest.status === "failed" && newest.id !== dismissed
      ? { sessionId: newest.id, label: newest.label, reason: newest.failureReason, canRestart: canRestart(newest.id), at: (newest.endedAt ?? newest.startedAt).toISOString() }
      : null;

  return {
    serverNow: now.toISOString(),
    schedule: {
      onAir,
      next: view.next ? shape(view.next) : null,
      greenRoom: view.greenRoom.map(shape),
      blockedCurrent: !!shifts.find((s) => blocked.has(s.id) && s.startsAt <= now && now < s.endsAt),
    },
    room,
    controls: { transitionOn: settings.transitionOn, mutedOnAir: !!view.onAir && settings.forceMuteShiftId === view.onAir.id },
    worker: { lastSeen: workerBeat, error: workerError || null },
    streams,
    alert,
    diagnostics: {
      egressCount: streams.length,
      onAir: onAir
        ? {
            name: onAir.name,
            connected: onAir.connected,
            serverSees: onAirParticipant?.tracks ?? [],
            canPublish: onAirParticipant?.canPublish ?? false,
            heartbeat: hb && { ageSec: Math.round((Date.now() - hb.at) / 1000), quality: hb.quality, rttMs: hb.rttMs, uplinkKbps: hb.uplinkKbps, fps: hb.fps, width: hb.width, height: hb.height, limitation: hb.limitation, publishing: hb.publishing },
          }
        : null,
      recorders: room.recorders,
    },
    events: events.map((e) => ({ id: e.id, at: e.at.toISOString(), type: e.type, message: e.message })),
  };
}
