/**
 * In-memory store of the latest "how is my connection" report from each astrologer's browser.
 * Shown on the ops diagnostics panel (LiveKit's API does not expose these numbers). Lost on restart — that's fine.
 */
export interface Heartbeat {
  astrologerId: string;
  at: number; // ms epoch (server clock)
  phase: string;
  quality: string; // excellent | good | poor | lost | unknown
  rttMs: number | null;
  uplinkKbps: number | null;
  fps: number | null;
  width: number | null;
  height: number | null;
  limitation: string | null;
  connection: string; // LiveKit connection state
  publishing: boolean;
}

const g = globalThis as unknown as { __hb?: Map<string, Heartbeat> };
const store = (g.__hb ??= new Map<string, Heartbeat>());

export function saveHeartbeat(h: Heartbeat) {
  store.set(h.astrologerId, h);
}
export function getHeartbeat(astrologerId: string): Heartbeat | null {
  const h = store.get(astrologerId);
  return h && Date.now() - h.at < 60_000 ? h : null;
}
