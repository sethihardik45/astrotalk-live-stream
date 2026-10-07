"use client";

import { useEffect, useRef, useState } from "react";
import type { LocalVideoTrack } from "livekit-client";
import { S } from "@/lib/strings";
import { formatDuration } from "@/lib/time";
import type { LocalMedia } from "./useLocalMedia";
import type { RoomConn } from "./useLiveRoom";

/** Big HH:MM:SS style countdown. `ms` is the remaining time. */
export function Countdown({ ms, className = "" }: { ms: number; className?: string }) {
  return (
    <span className={`font-mono tabular-nums ${className}`} aria-live="off">
      {formatDuration(Math.ceil(ms / 1000))}
    </span>
  );
}

/**
 * Local self-view. With `guide`, dims the left and right edges to show the part of the picture that survives the
 * 9:16 portrait crop on Instagram (a landscape camera is cropped to a centre slice — about 32% of its width).
 */
export function VideoPreview({ track, off, guide = true }: { track: LocalVideoTrack | null; off: boolean; guide?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !track) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
      {/* Mirrored like a mirror, which feels natural; viewers see the un-mirrored picture. */}
      <video ref={ref} muted playsInline autoPlay className="h-full w-full -scale-x-100 object-cover" />
      {!track && <div className="absolute inset-0 grid place-items-center text-sm text-[var(--muted)]">{S.live.camera}</div>}
      {track && off && <div className="absolute inset-0 grid place-items-center bg-black text-sm text-[var(--muted)]">{S.live.cameraIsOff}</div>}
      {track && guide && !off && (
        <>
          <div className="pointer-events-none absolute inset-y-0 left-0 w-[34.2%] bg-black/60" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-[34.2%] bg-black/60" />
          <div className="pointer-events-none absolute inset-x-0 bottom-1 text-center text-[11px] text-white/80">{S.live.framingGuide}</div>
        </>
      )}
    </div>
  );
}

export function MicMeter({ level, muted }: { level: number; muted: boolean }) {
  const pct = muted ? 0 : Math.round(level * 100);
  return (
    <div>
      <div className="mb-1 text-sm text-[var(--muted)]">{S.live.micLevel}</div>
      <div
        className="h-3 w-full overflow-hidden rounded-full bg-[#0f131c]"
        role="meter"
        aria-label={S.live.micLevel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div className="h-full rounded-full bg-[var(--good)] transition-[width] duration-75" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function DevicePanel({ media, compact = false }: { media: LocalMedia; compact?: boolean }) {
  const { status } = media;
  const notReady = status !== "ready";

  return (
    <section className="panel space-y-4 p-4 sm:p-5" aria-label={S.live.testDevices}>
      {!compact && (
        <div>
          <h2 className="text-lg font-semibold">{S.live.testDevices}</h2>
          <p className="text-sm text-[var(--muted)]">{S.live.testDevicesHelp}</p>
        </div>
      )}

      <VideoPreview track={media.video} off={media.camOff} />

      {notReady && (
        <div className="space-y-3">
          {status === "denied" && <p className="rounded-lg bg-red-950/60 p-3 text-sm text-red-200">{S.live.devicesDenied}</p>}
          {status === "nodevice" && <p className="rounded-lg bg-amber-950/60 p-3 text-sm text-amber-200">{S.live.devicesMissing}</p>}
          {status === "error" && <p className="rounded-lg bg-amber-950/60 p-3 text-sm text-amber-200">{S.live.devicesError}</p>}
          <button className="btn btn-primary w-full" onClick={() => void media.start()} disabled={status === "starting"}>
            {status === "starting" ? "..." : S.live.turnOnDevices}
          </button>
        </div>
      )}

      {status === "ready" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--muted)]">{S.live.camera}</span>
            <select className="input" value={media.camId} onChange={(e) => void media.setCam(e.target.value)}>
              {media.cams.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `${S.live.camera} ${i + 1}`}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--muted)]">{S.live.microphone}</span>
            <select className="input" value={media.micId} onChange={(e) => void media.setMic(e.target.value)}>
              {media.mics.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `${S.live.microphone} ${i + 1}`}
                </option>
              ))}
            </select>
          </label>
          <div className="sm:col-span-2">
            <MicMeter level={media.level} muted={media.micMuted} />
          </div>
        </div>
      )}
    </section>
  );
}

type Rating = "good" | "ok" | "poor";

/** A quick pre-flight internet check: round-trip time to our server and upload speed. Nothing here touches LiveKit. */
export function NetworkCheck() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ rtt: number; jitter: number; upMbps: number; rating: Rating } | null>(null);
  const [failed, setFailed] = useState(false);

  async function run() {
    setBusy(true);
    setFailed(false);
    try {
      const rtts: number[] = [];
      for (let i = 0; i < 6; i++) {
        const t = performance.now();
        const r = await fetch("/api/live/ping", { cache: "no-store" });
        if (!r.ok) throw new Error("ping");
        rtts.push(performance.now() - t);
      }
      const sorted = [...rtts].sort((a, b) => a - b);
      const rtt = sorted[Math.floor(sorted.length / 2)];
      const jitter = sorted[sorted.length - 1] - sorted[0];

      const payload = new Uint8Array(512 * 1024);
      const t0 = performance.now();
      const up = await fetch("/api/live/ping", { method: "POST", body: payload, cache: "no-store" });
      if (!up.ok) throw new Error("upload");
      const secs = (performance.now() - t0) / 1000;
      const upMbps = (payload.byteLength * 8) / 1_000_000 / secs;

      const rating: Rating = rtt > 250 || upMbps < 2.5 ? "poor" : rtt > 120 || upMbps < 5 || jitter > 200 ? "ok" : "good";
      setResult({ rtt: Math.round(rtt), jitter: Math.round(jitter), upMbps: Math.round(upMbps * 10) / 10, rating });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const colour = result?.rating === "good" ? "text-green-400" : result?.rating === "ok" ? "text-amber-300" : "text-red-300";
  return (
    <section className="panel space-y-3 p-4 sm:p-5">
      <button className="btn" onClick={() => void run()} disabled={busy}>
        {busy ? S.live.networkChecking : S.live.networkCheck}
      </button>
      {failed && <p className="text-sm text-red-300">{S.live.networkFailed}</p>}
      {result && (
        <p className={`text-sm ${colour}`} role="status">
          {result.rating === "good" ? S.live.networkGood : result.rating === "ok" ? S.live.networkOk : S.live.networkPoor}{" "}
          <span className="text-[var(--muted)]">
            (delay {result.rtt} ms, upload about {result.upMbps} Mbps)
          </span>
        </p>
      )}
    </section>
  );
}

export function TipCards() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <aside className="rounded-2xl border border-amber-500/50 bg-amber-950/40 p-4">
        <h3 className="font-semibold text-amber-200">{S.live.tipEchoTitle}</h3>
        <p className="mt-1 text-sm text-amber-100/90">{S.live.tipEcho}</p>
      </aside>
      <aside className="rounded-2xl border border-sky-500/40 bg-sky-950/30 p-4">
        <h3 className="font-semibold text-sky-200">{S.live.tipSetupTitle}</h3>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-sky-100/90">
          {S.live.tipSetup.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

export function ConnectionBadge({ conn, quality }: { conn: RoomConn; quality: string }) {
  const label =
    conn === "connected"
      ? S.live.connection.connected
      : conn === "reconnecting"
        ? S.live.connection.reconnecting
        : conn === "connecting"
          ? S.live.connection.connecting
          : S.live.connection.disconnected;
  const dot = conn === "connected" ? "bg-green-500" : conn === "reconnecting" || conn === "connecting" ? "bg-amber-400" : "bg-red-500";
  const q = conn === "connected" ? (S.live.quality[quality] ?? S.live.quality.unknown) : null;
  return (
    <div className="flex flex-wrap items-center gap-2" role="status" aria-live="polite">
      <span className="badge">
        <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
        {label}
      </span>
      {q && <span className="badge">Quality: {q}</span>}
    </div>
  );
}
