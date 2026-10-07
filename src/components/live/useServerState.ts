"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface ServerState {
  serverNow: string;
  astrologer: { name: string; tagline: string | null; photoUrl: string | null };
  phase: "none" | "waiting" | "greenroom" | "onair" | "over";
  shifts: { id: string; startsAt: string; endsAt: string }[];
  removedByOps: boolean;
  leadMinutes: number;
  warnMinutes: number[];
}

/**
 * Polls /api/live/state (a POST, so the secret never sits in a URL) every 5 seconds and works out how far the browser clock is from the server clock,
 * so countdowns match what the server is doing even if the astrologer's computer clock is wrong.
 */
export function useServerState(slug: string) {
  const [state, setState] = useState<ServerState | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [offline, setOffline] = useState(false);
  const offsetRef = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const t0 = Date.now();
      const res = await fetch("/api/live/state", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug }), cache: "no-store" });
      const t1 = Date.now();
      if (res.status === 404) return setInvalid(true);
      if (!res.ok) return; // 429 or 5xx: keep showing the last known state
      const data = (await res.json()) as ServerState;
      // assume the server stamped the time halfway through the round trip
      offsetRef.current = new Date(data.serverNow).getTime() - (t0 + (t1 - t0) / 2);
      setState(data);
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, [slug]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    const onVisible = () => document.visibilityState === "visible" && refresh();
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  /** "Now" according to the server clock. */
  const nowMs = useCallback(() => Date.now() + offsetRef.current, []);
  return { state, invalid, offline, refresh, nowMs };
}

/** Re-render a few times a second; returns the current server-clock time in ms. */
export function useNow(nowMs: () => number, everyMs = 250) {
  const [now, setNow] = useState(() => nowMs());
  useEffect(() => {
    const id = setInterval(() => setNow(nowMs()), everyMs);
    return () => clearInterval(id);
  }, [nowMs, everyMs]);
  return now;
}
