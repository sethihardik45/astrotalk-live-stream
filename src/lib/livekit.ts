import { AccessToken, EgressClient, RoomServiceClient, type VideoGrant } from "livekit-server-sdk";
import { env, livekitHttpUrl } from "./env";

/**
 * All LiveKit server-side access goes through here. The URL / key / secret come from environment variables, so the same
 * code works against LiveKit Cloud or a self-hosted LiveKit server.
 *
 * Clients are created once per process (cheap objects, but no need to rebuild them every request).
 */
const g = globalThis as unknown as { __lk?: { room: RoomServiceClient; egress: EgressClient } };

function clients() {
  if (!g.__lk) {
    const e = env();
    g.__lk = {
      room: new RoomServiceClient(livekitHttpUrl(), e.LIVEKIT_API_KEY, e.LIVEKIT_API_SECRET),
      egress: new EgressClient(livekitHttpUrl(), e.LIVEKIT_API_KEY, e.LIVEKIT_API_SECRET),
    };
  }
  return g.__lk;
}

/** TESTS ONLY: swap the real LiveKit clients for fakes (pass null to go back to the real ones). */
export function __setClientsForTests(fake: { room: unknown; egress: unknown } | null) {
  g.__lk = (fake ?? undefined) as typeof g.__lk;
}

export const roomService = () => clients().room;
export const egressClient = () => clients().egress;
export const roomName = () => env().ROOM_NAME;

/**
 * Token for an astrologer.
 *
 * SECURITY MODEL: the token starts with canPublish = false. The ONLY thing that can ever raise it is our worker
 * calling updateParticipant() when the schedule says it is this person's turn. A tampered browser holding this token
 * cannot publish, because LiveKit's server enforces the grant.
 *
 * canSubscribe = false: astrologers never need to see or hear anyone else (they watch Instagram on a second device).
 * That also means a hacked astrologer page can't eavesdrop on the room.
 */
export async function mintAstrologerToken(args: { identity: string; name: string; ttlSeconds: number }): Promise<string> {
  const e = env();
  const at = new AccessToken(e.LIVEKIT_API_KEY, e.LIVEKIT_API_SECRET, {
    identity: args.identity,
    name: args.name,
    ttl: args.ttlSeconds, // seconds
  });
  const grant: VideoGrant = {
    room: e.ROOM_NAME,
    roomJoin: true,
    canPublish: false,
    canSubscribe: false,
    canPublishData: false,
    canUpdateOwnMetadata: false,
  };
  at.addGrant(grant);
  return at.toJwt();
}

/**
 * Create the room with a very long empty timeout. LiveKit normally deletes a room 5 minutes after the last person leaves,
 * and that would kick our egress (the thing sending video to Instagram) during quiet periods or the transition video.
 * createRoom is safe to call repeatedly: for an existing room it just returns it.
 */
export async function ensureRoom(): Promise<void> {
  await roomService().createRoom({
    name: env().ROOM_NAME,
    emptyTimeout: 60 * 60 * 24, // seconds (1 day)
    departureTimeout: 60 * 60 * 24,
    maxParticipants: 100,
  });
}
