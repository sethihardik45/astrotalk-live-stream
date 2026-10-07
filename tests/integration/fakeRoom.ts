import type { RoomApi } from "@/lib/enforce";

interface FakeParticipant {
  identity: string;
  kind: number; // 0 = standard browser, 2 = egress recorder
  permission: { canPublish: boolean };
}

/**
 * A stand-in for LiveKit's room service. It remembers what was changed, and records every call in order,
 * so tests can check both the final state and the SEQUENCE (grant → metadata → revoke).
 */
export class FakeRoom {
  participants: FakeParticipant[] = [];
  metadata = "";
  exists = true;
  calls: string[] = [];

  join(identity: string, opts: { canPublish?: boolean; kind?: number } = {}) {
    this.participants.push({ identity, kind: opts.kind ?? 0, permission: { canPublish: opts.canPublish ?? false } });
  }
  get(identity: string) {
    return this.participants.find((p) => p.identity === identity);
  }
  resetCalls() {
    this.calls = [];
  }

  api(): RoomApi {
    const self = this;
    return {
      async listRooms() {
        return self.exists ? [{ name: "astrotalk-live", metadata: self.metadata }] : [];
      },
      async createRoom() {
        self.calls.push("createRoom");
        self.exists = true;
        return { name: "astrotalk-live", metadata: self.metadata };
      },
      async listParticipants() {
        return self.participants.map((p) => ({ ...p, permission: { ...p.permission } }));
      },
      async updateParticipant(_room: string, identity: string, options: { permission?: { canPublish?: boolean } }) {
        const p = self.get(identity);
        if (p && options.permission) p.permission = { canPublish: !!options.permission.canPublish };
        self.calls.push(`${options.permission?.canPublish ? "grant" : "revoke"}:${identity}`);
        return {};
      },
      async updateRoomMetadata(_room: string, metadata: string) {
        self.metadata = metadata;
        self.calls.push("metadata");
        return {};
      },
      async removeParticipant(_room: string, identity: string) {
        self.participants = self.participants.filter((p) => p.identity !== identity);
        self.calls.push(`remove:${identity}`);
      },
    } as unknown as RoomApi;
  }
}
