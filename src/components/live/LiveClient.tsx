"use client";

import { useEffect, useMemo, useRef } from "react";
import { S } from "@/lib/strings";
import { formatDateTimeIst, formatTimeIst } from "@/lib/time";
import { astrologerStatus } from "@/lib/schedule/onAir";
import { Countdown, ConnectionBadge, DevicePanel, NetworkCheck, TipCards } from "./parts";
import { useLiveRoom } from "./useLiveRoom";
import { useLocalMedia } from "./useLocalMedia";
import { useNow, useServerState } from "./useServerState";

/**
 * The whole astrologer page. The phase (waiting / green room / on air / over) is computed in the browser from the
 * shift times and the SERVER clock, every 250 ms, so countdowns and screen changes are instant. What actually puts
 * someone on air is the server granting publish permission (see useLiveRoom).
 */
export function LiveClient({ slug }: { slug: string }) {
  const { state, invalid, offline, refresh, nowMs } = useServerState(slug);
  const now = useNow(nowMs);
  const media = useLocalMedia();

  const shifts = useMemo(
    () => (state?.shifts ?? []).map((s) => ({ id: s.id, astrologerId: "me", startsAt: new Date(s.startsAt), endsAt: new Date(s.endsAt) })),
    [state?.shifts],
  );
  const leadMs = (state?.leadMinutes ?? 10) * 60_000;
  const status = useMemo(() => astrologerStatus(shifts, new Date(now), leadMs), [shifts, now, leadMs]);

  const removed = !!state?.removedByOps;
  const phase = status.phase;
  const wantConnection = !removed && (phase === "greenroom" || phase === "onair");
  const wantPublish = !removed && phase === "onair";

  const room = useLiveRoom({ slug, wantConnection, wantPublish, media, onNeedRefresh: refresh });

  // Turn the camera on by itself if the browser already trusts this site (no prompt in that case).
  const { start: startMedia, stop: stopMedia, status: mediaStatus } = media;
  const triedAuto = useRef(false);
  useEffect(() => {
    if (triedAuto.current || mediaStatus !== "idle" || (phase !== "waiting" && phase !== "greenroom" && phase !== "onair")) return;
    triedAuto.current = true;
    (async () => {
      try {
        const [cam, mic] = await Promise.all([
          navigator.permissions.query({ name: "camera" as PermissionName }),
          navigator.permissions.query({ name: "microphone" as PermissionName }),
        ]);
        if (cam.state === "granted" && mic.state === "granted") await startMedia();
      } catch {
        /* permissions API not available (e.g. some Safari versions): the button is shown instead */
      }
    })();
  }, [phase, mediaStatus, startMedia]);

  // Shift over: let go of the camera and microphone straight away (this also switches the camera light off).
  useEffect(() => {
    if (phase === "over" || phase === "none" || removed) stopMedia();
  }, [phase, removed, stopMedia]);

  // Keep the screen awake while waiting in the green room or on air (best effort).
  useEffect(() => {
    if (!wantConnection) return;
    let lock: WakeLockSentinel | null = null;
    const get = () => navigator.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => {});
    void get();
    const onVis = () => document.visibilityState === "visible" && void get();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      void lock?.release().catch(() => {});
    };
  }, [wantConnection]);

  // ---------------------------------------------------------------- rendering
  if (invalid) return <Shell><NotValid /></Shell>;
  if (!state) return <Shell><p className="text-[var(--muted)]">...</p></Shell>;

  const name = state.astrologer.name;
  const shift = status.shift;
  const upcoming = shifts.filter((s) => s.startsAt.getTime() > now).slice(0, 5);

  if (room.replaced) {
    return (
      <Shell header={<Header name={name} tagline={state.astrologer.tagline} />}>
        <Card tone="warn" title={S.live.replacedTitle}>
          <p>{S.live.replacedBody}</p>
          <button className="btn btn-primary mt-4" onClick={room.takeOverAgain}>
            {S.live.useThisOne}
          </button>
        </Card>
      </Shell>
    );
  }

  if (removed) {
    return (
      <Shell header={<Header name={name} tagline={state.astrologer.tagline} />}>
        <Card tone="bad" title={S.live.removedTitle}>
          <p>{S.live.removedBody}</p>
        </Card>
      </Shell>
    );
  }

  if (phase === "over") {
    return (
      <Shell header={<Header name={name} tagline={state.astrologer.tagline} />}>
        <Card tone="good" title={S.live.overTitle}>
          <p>{S.live.overBody}</p>
          {status.nextShift && <p className="mt-2 text-[var(--muted)]">{S.live.overNext(formatDateTimeIst(status.nextShift.startsAt))}</p>}
        </Card>
      </Shell>
    );
  }

  if (phase === "none" || !shift) {
    return (
      <Shell header={<Header name={name} tagline={state.astrologer.tagline} />}>
        <Card title={S.live.noShifts}>
          <p className="text-[var(--muted)]">{S.live.noShiftsHelp}</p>
        </Card>
      </Shell>
    );
  }

  const header = <Header name={name} tagline={state.astrologer.tagline} />;
  const banners = offline ? <p className="rounded-lg bg-amber-950/60 p-3 text-sm text-amber-200">{S.live.offline}</p> : null;

  if (phase === "waiting") {
    return (
      <Shell header={header}>
        {banners}
        <Card title={S.live.nextShift}>
          <p className="text-2xl font-bold">{formatDateTimeIst(shift.startsAt)}</p>
          <p className="mt-3 text-sm text-[var(--muted)]">{S.live.startsIn}</p>
          <Countdown ms={shift.startsAt.getTime() - now} className="text-5xl font-bold sm:text-6xl" />
          <p className="mt-3 text-sm text-[var(--muted)]">{S.live.greenRoomOpens(state.leadMinutes)}</p>
        </Card>
        <DevicePanel media={media} />
        <NetworkCheck />
        <TipCards />
        {upcoming.length > 1 && (
          <Card title={S.live.upcoming}>
            <ul className="space-y-1 text-sm">
              {upcoming.map((s) => (
                <li key={s.id}>{formatDateTimeIst(s.startsAt)}</li>
              ))}
            </ul>
          </Card>
        )}
        <p className="text-center text-xs text-[var(--muted)]">{S.live.timeZoneNote}</p>
      </Shell>
    );
  }

  if (phase === "greenroom") {
    return (
      <Shell header={header}>
        {banners}
        <Card tone="good" title={S.live.greenRoomTitle}>
          <p className="text-xl font-semibold">{S.live.greenRoomBody(formatTimeIst(shift.startsAt))}</p>
          <Countdown ms={shift.startsAt.getTime() - now} className="mt-2 block text-5xl font-bold" />
          <p className="mt-3 text-sm text-[var(--muted)]">{S.live.greenRoomHelp}</p>
          <div className="mt-3">
            <ConnectionBadge conn={room.conn} quality={room.quality} />
          </div>
        </Card>
        <DevicePanel media={media} compact />
        <TipCards />
      </Shell>
    );
  }

  // ---- ON AIR ----
  const remainingMs = shift.endsAt.getTime() - now;
  const live = room.publishing && room.canPublish;
  const warn = currentWarning(remainingMs, state.warnMinutes);
  return (
    <Shell header={header}>
      {banners}
      <div
        className={`rounded-2xl border p-5 text-center ${live ? "border-red-500 bg-red-950/50" : "border-amber-500 bg-amber-950/40"}`}
        role="status"
        aria-live="polite"
      >
        <div
          className={`mx-auto inline-flex items-center gap-3 rounded-full px-8 py-3 text-3xl font-extrabold tracking-widest sm:text-4xl ${
            live ? "on-air-pulse bg-red-600 text-white" : "bg-amber-500 text-black"
          }`}
        >
          <span className="h-4 w-4 rounded-full bg-white" />
          {live ? S.live.onAir : S.live.goingOnAir}
        </div>
        <p className="mt-4 text-sm text-[var(--muted)]">{S.live.timeLeft}</p>
        <Countdown ms={remainingMs} className="text-6xl font-bold sm:text-7xl" />
        {warn != null && <p className="mt-3 rounded-lg bg-amber-500 px-3 py-2 text-lg font-bold text-black">{S.live.warn(warn)}</p>}
        <div className="mt-4 flex justify-center">
          <ConnectionBadge conn={room.conn} quality={room.quality} />
        </div>
      </div>

      {media.status !== "ready" && (
        <button className="btn btn-danger w-full text-lg" onClick={() => void media.start()}>
          {S.live.turnOnDevices}
        </button>
      )}

      <div className="grid grid-cols-2 gap-3">
        <button className={`btn text-base ${media.micMuted ? "btn-danger" : ""}`} onClick={() => void media.toggleMic()} disabled={media.status !== "ready"} aria-pressed={media.micMuted}>
          {media.micMuted ? S.live.unmuteMic : S.live.muteMic}
        </button>
        <button className={`btn text-base ${media.camOff ? "btn-danger" : ""}`} onClick={() => void media.toggleCam()} disabled={media.status !== "ready"} aria-pressed={media.camOff}>
          {media.camOff ? S.live.cameraOn : S.live.cameraOff}
        </button>
      </div>
      {media.micMuted && <p className="rounded-lg bg-red-950/60 p-3 text-sm text-red-200">{S.live.micIsMuted}</p>}

      <DevicePanel media={media} compact />
      <TipCards />
    </Shell>
  );
}

/** Which warning (in minutes) to show right now, if any: the smallest threshold we have passed. */
function currentWarning(remainingMs: number, thresholds: number[]): number | null {
  const passed = thresholds.filter((m) => remainingMs <= m * 60_000 && remainingMs > 0);
  return passed.length ? Math.min(...passed) : null;
}

// ---------------------------------------------------------------- small layout helpers

function Shell({ children, header }: { children: React.ReactNode; header?: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-4 px-4 py-6 sm:py-10">
      {header}
      {children}
    </main>
  );
}

function Header({ name, tagline }: { name: string; tagline: string | null }) {
  return (
    <header>
      <p className="text-sm text-[var(--muted)]">{S.appName}</p>
      <h1 className="text-2xl font-bold sm:text-3xl">{S.live.hello(name)}</h1>
      {tagline && <p className="text-[var(--muted)]">{tagline}</p>}
    </header>
  );
}

function Card({ title, tone, children }: { title: string; tone?: "good" | "warn" | "bad"; children: React.ReactNode }) {
  const border = tone === "good" ? "border-green-500/50" : tone === "warn" ? "border-amber-500/60" : tone === "bad" ? "border-red-500/60" : "border-[var(--line)]";
  return (
    <section className={`panel border p-5 ${border}`}>
      <h2 className="mb-2 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function NotValid() {
  return (
    <div className="py-20 text-center">
      <h1 className="text-2xl font-bold">{S.invalid.title}</h1>
      <p className="mt-2 text-[var(--muted)]">{S.invalid.body}</p>
    </div>
  );
}
