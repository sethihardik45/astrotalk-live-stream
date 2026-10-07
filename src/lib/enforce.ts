import { ParticipantInfo_Kind } from "@livekit/protocol";
import { TrackSource, type ParticipantInfo, type RoomServiceClient } from "livekit-server-sdk";
import { db } from "./db";
import { logEvent } from "./events";
import { roomName, roomService } from "./livekit";
import { planEnforcement, type EnforcementPlan } from "./schedule/enforce";
import { parseRoomMetadata, serializeRoomMetadata, type RoomMetadata } from "./schedule/roomMetadata";
import { loadSettings } from "./settings";
import { getBlockedShiftIds } from "./stage";
import { safeErrorMessage } from "./redact";

/**
 * "Make the LiveKit room match the schedule." One call = one pass. Called every 2 seconds by the worker, and also by the
 * ops buttons (mute, transition, skip, remove) so their effect is instant instead of waiting for the next tick.
 *
 * IDEMPOTENT and safe to run from two places at once: it reads the real room state each time and only changes what differs.
 *
 * Order matters for a clean hand-off:
 *   1. grant the NEW on-air person permission        (their already-prepared camera starts publishing)
 *   2. switch the room metadata to the new person     (the layout page switches who it shows)
 *   3. revoke the OLD person and remove people who are done
 * so the Instagram stream never has a moment where the layout shows nobody for longer than the new camera's first frame.
 */

/** The slice of LiveKit's RoomServiceClient we use. Tests pass a fake with the same shape. */
export type RoomApi = Pick<
  RoomServiceClient,
  "listRooms" | "listParticipants" | "updateParticipant" | "updateRoomMetadata" | "removeParticipant" | "createRoom"
>;

export interface EnforceResult {
  plan: EnforcementPlan;
  metadata: RoomMetadata;
  participantCount: number;
  changed: string[];
  errors: string[];
}

/** The permission set for an astrologer. LiveKit applies permissions atomically, so we always send ALL fields. */
function permissionFor(canPublish: boolean) {
  return {
    canSubscribe: false,
    canPublish,
    canPublishData: false,
    // Even when publishing is allowed it is limited to camera and microphone: no screen share, no data.
    canPublishSources: canPublish ? [TrackSource.CAMERA, TrackSource.MICROPHONE] : [],
    canUpdateMetadata: false,
    hidden: false,
  };
}

export async function enforceOnce(now = new Date(), svc: RoomApi = roomService()): Promise<EnforceResult> {
  const room = roomName();
  const changed: string[] = [];
  const errors: string[] = [];

  const [settings, blocked, astrologers] = await Promise.all([
    loadSettings(),
    getBlockedShiftIds(),
    db.astrologer.findMany({ where: { active: true }, select: { id: true, name: true, tagline: true } }),
  ]);
  const byId = new Map(astrologers.map((a) => [a.id, a]));

  const shifts = await db.shift.findMany({
    where: { endsAt: { gt: new Date(now.getTime() - settings.graceMs - 60_000) }, startsAt: { lt: new Date(now.getTime() + 24 * 3_600_000) } },
    orderBy: { startsAt: "asc" },
  });

  // ---- what LiveKit currently has
  let rooms = await svc.listRooms([room]);
  if (rooms.length === 0) {
    // The room is missing (LiveKit deletes empty rooms eventually). Recreate it with a long empty-timeout.
    await svc.createRoom({ name: room, emptyTimeout: 60 * 60 * 24, departureTimeout: 60 * 60 * 24, maxParticipants: 100 });
    rooms = await svc.listRooms([room]);
  }
  const currentMetadata = rooms[0]?.metadata ?? "";
  const all: ParticipantInfo[] = await svc.listParticipants(room);
  // Only real browsers. The egress recorder (kind EGRESS) and any other service participants are none of our business.
  const people = all.filter((p) => p.kind === ParticipantInfo_Kind.STANDARD);

  const plan = planEnforcement({
    participants: people.map((p) => ({ identity: p.identity, canPublish: !!p.permission?.canPublish })),
    shifts,
    now,
    leadMs: settings.leadMs,
    graceMs: settings.graceMs,
    blockedShiftIds: blocked,
    activeAstrologerIds: new Set(byId.keys()),
  });

  // 1. grants first
  for (const id of plan.grant) {
    try {
      await svc.updateParticipant(room, id, { permission: permissionFor(true) });
      changed.push(`grant:${id}`);
      await logEvent("permission", `${byId.get(id)?.name ?? id} was allowed to go on air`);
    } catch (e) {
      errors.push(`grant ${id}: ${safeErrorMessage(e)}`);
    }
  }

  // 2. room metadata (what the layout page shows)
  const onAir = plan.onAirIdentity ? byId.get(plan.onAirIdentity) : undefined;
  const nextName = plan.nextShift ? (byId.get(plan.nextShift.astrologerId)?.name ?? null) : null;
  const metadata: RoomMetadata = {
    onAirIdentity: onAir ? onAir.id : null,
    onAirName: onAir?.name ?? null,
    onAirTagline: onAir?.tagline ?? null,
    nextName,
    nextStartsAt: plan.nextShift ? plan.nextShift.startsAt.toISOString() : null,
    transition: settings.transitionOn,
    muted: !!plan.onAirShift && plan.onAirShift.id === settings.forceMuteShiftId,
    transitionUrl: settings.transitionUrl,
  };
  const desired = serializeRoomMetadata(metadata);
  if (desired !== currentMetadata) {
    try {
      await svc.updateRoomMetadata(room, desired);
      changed.push("metadata");
      const before = parseRoomMetadata(currentMetadata);
      if (before.onAirIdentity !== metadata.onAirIdentity) {
        await logEvent("shift", metadata.onAirIdentity ? `${metadata.onAirName} is now on air` : "Nobody is on air (transition video)");
      }
    } catch (e) {
      errors.push(`metadata: ${safeErrorMessage(e)}`);
    }
  }

  // 3. revokes and removals
  for (const id of plan.revoke) {
    try {
      await svc.updateParticipant(room, id, { permission: permissionFor(false) });
      changed.push(`revoke:${id}`);
      await logEvent("permission", `${byId.get(id)?.name ?? id} can no longer publish`);
    } catch (e) {
      errors.push(`revoke ${id}: ${safeErrorMessage(e)}`);
    }
  }
  for (const id of plan.remove) {
    try {
      await svc.removeParticipant(room, id);
      changed.push(`remove:${id}`);
      await logEvent("shift", `${byId.get(id)?.name ?? id} was removed from the room`);
    } catch (e) {
      errors.push(`remove ${id}: ${safeErrorMessage(e)}`);
    }
  }

  return { plan, metadata, participantCount: people.length, changed, errors };
}
