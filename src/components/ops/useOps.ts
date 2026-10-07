"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { OpsSnapshot } from "@/lib/opsState";

/** Polls /api/ops/state every 2 seconds. A 401 (logged out / session expired) sends you to the login page. */
export function useOpsState() {
  const [state, setState] = useState<OpsSnapshot | null>(null);
  const [offline, setOffline] = useState(false);
  const offsetRef = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const t0 = Date.now();
      const res = await fetch("/api/ops/state", { cache: "no-store" });
      if (res.status === 401) {
        window.location.href = "/ops/login";
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as OpsSnapshot;
      offsetRef.current = new Date(data.serverNow).getTime() - (t0 + (Date.now() - t0) / 2);
      setState(data);
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [refresh]);

  const nowMs = useCallback(() => Date.now() + offsetRef.current, []);
  return { state, offline, refresh, nowMs };
}

export interface ActionResult {
  ok: boolean;
  message: string;
  data?: Record<string, unknown>;
}

/** POST JSON to an ops route and turn the answer into a plain message. */
export async function opsAction(path: string, body: Record<string, unknown> = {}, method: "POST" | "PATCH" | "DELETE" = "POST"): Promise<ActionResult> {
  try {
    const res = await fetch(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (res.status === 401) {
      window.location.href = "/ops/login";
      return { ok: false, message: "Logged out" };
    }
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) return { ok: true, message: "Done", data };
    const msg = typeof data.message === "string" ? data.message : res.status === 429 ? "Too many requests, wait a moment." : "That did not work. Please try again.";
    return { ok: false, message: msg, data };
  } catch {
    return { ok: false, message: "Could not reach the server." };
  }
}
