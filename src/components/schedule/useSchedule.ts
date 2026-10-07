"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { scheduleSnapshot } from "@/lib/adminData";
import { addDaysToKey, dowOfKey, istDateKey, istToUtc } from "@/lib/time";

export type ScheduleSnapshot = Awaited<ReturnType<typeof scheduleSnapshot>>;
export type ScheduleShift = ScheduleSnapshot["shifts"][number];
export type ScheduleAstrologer = ScheduleSnapshot["astrologers"][number];
export type ScheduleTemplate = ScheduleSnapshot["templates"][number];

/** The Monday (IST) of the week containing `d`, as a yyyy-mm-dd key. */
export function mondayKeyOf(d: Date): string {
  const key = istDateKey(d);
  return addDaysToKey(key, -((dowOfKey(key) + 6) % 7));
}

/** Loads the schedule for the week starting at `mondayKey`, and reloads it every 15 seconds and on demand. */
export function useSchedule(mondayKey: string) {
  const [data, setData] = useState<ScheduleSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const keyRef = useRef(mondayKey);
  keyRef.current = mondayKey; // eslint-disable-line react-hooks/refs -- latest value for the async refresh below

  const refresh = useCallback(async () => {
    try {
      const from = istToUtc(keyRef.current, "00:00").toISOString();
      const res = await fetch(`/api/ops/schedule?from=${encodeURIComponent(from)}&days=7`, { cache: "no-store" });
      if (res.status === 401) {
        window.location.href = "/ops/login";
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as ScheduleSnapshot);
      setError(null);
    } catch {
      setError("Could not load the schedule. Retrying…");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 15_000);
    return () => clearInterval(id);
  }, [refresh, mondayKey]);

  return { data, error, refresh };
}

/** Copy text to the clipboard; falls back to a hidden textarea for older browsers / non-https. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
