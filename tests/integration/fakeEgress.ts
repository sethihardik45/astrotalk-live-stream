import { EgressInfo, EgressStatus } from "livekit-server-sdk";

/** A stand-in for LiveKit's egress service that remembers what it was asked to do. */
export class FakeEgress {
  started: Array<{ room: string; urls: string[]; opts: Record<string, unknown> }> = [];
  stopped: string[] = [];
  running = new Map<string, EgressStatus>();
  failStart = false;
  /** Egress ids LiveKit currently reports as ENDING (still in the active list). */
  ending = new Set<string>();
  /** Make stopEgress fail with this message. */
  stopError: string | null = null;
  private n = 0;

  async startRoomCompositeEgress(room: string, output: { urls: string[] }, opts: Record<string, unknown>) {
    if (this.failStart) throw new Error(`could not connect to ${output.urls[0]}`); // an error that leaks the key, on purpose
    const id = `EG_fake${++this.n}`;
    this.started.push({ room, urls: output.urls, opts });
    this.running.set(id, EgressStatus.EGRESS_ACTIVE);
    return new EgressInfo({ egressId: id, status: EgressStatus.EGRESS_STARTING });
  }
  async stopEgress(id: string) {
    if (this.stopError) throw new Error(this.stopError);
    this.stopped.push(id);
    this.running.delete(id);
    return new EgressInfo({ egressId: id, status: EgressStatus.EGRESS_ENDING });
  }
  async listEgress(opts: { active?: boolean; egressId?: string } = {}) {
    if (opts.egressId) {
      return [new EgressInfo({ egressId: opts.egressId, status: this.running.has(opts.egressId) ? EgressStatus.EGRESS_ACTIVE : EgressStatus.EGRESS_FAILED, error: "RTMP connection lost" })];
    }
    return [...this.running].map(([egressId, status]) => new EgressInfo({ egressId, status: this.ending.has(egressId) ? EgressStatus.EGRESS_ENDING : status }));
  }
  /** Simulate the stream dying on LiveKit's side. */
  kill(id: string) {
    this.running.delete(id);
  }
}

export const fakeRoomService = { createRoom: async () => ({}), listRooms: async () => [], listParticipants: async () => [] };
