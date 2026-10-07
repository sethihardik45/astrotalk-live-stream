"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OpsSnapshot } from "@/lib/opsState";
import { S } from "@/lib/strings";
import { formatDuration, formatTimeIst } from "@/lib/time";
import { ConfirmDialog } from "./ConfirmDialog";
import { AMBER_SECONDS, RED_SECONDS } from "@/lib/streamAge";
import { ageSeconds, StreamPanel } from "./StreamPanel";
import { TransitionVideoPanel } from "./TransitionVideoPanel";
import { opsAction, useOpsState, type ActionResult } from "./useOps";

function useTick(nowMs: () => number, every = 500) {
  const [now, setNow] = useState(() => nowMs());
  useEffect(() => {
    const id = setInterval(() => setNow(nowMs()), every);
    return () => clearInterval(id);
  }, [nowMs, every]);
  return now;
}

/** A short beep made in the browser (no sound file needed). */
function beep() {
  try {
    const Ctx: typeof AudioContext = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.15;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
    setTimeout(() => ctx.close().catch(() => {}), 600);
  } catch {
    /* no audio available */
  }
}

function readPref(key: string, fallback: boolean) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}
function writePref(key: string, v: boolean) {
  try {
    localStorage.setItem(key, v ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function OpsDashboard() {
  const { state, offline, refresh, nowMs } = useOpsState();
  const now = useTick(nowMs);
  const [toast, setToast] = useState<ActionResult | null>(null);
  const [confirm, setConfirm] = useState<"remove" | "skip" | null>(null);
  const [notifyOn, setNotifyOn] = useState(true);
  const [beepOn, setBeepOn] = useState(true);
  const firedRef = useRef(new Set<string>());

  useEffect(() => {
    setNotifyOn(readPref("opsNotify", true));
    setBeepOn(readPref("opsBeep", true));
  }, []);

  const report = useCallback((r: ActionResult) => {
    setToast(r);
    if (r.ok) setTimeout(() => setToast((t) => (t === r ? null : t)), 4000);
  }, []);

  // The oldest running stream decides the rotation warning.
  const oldest = useMemo(() => {
    if (!state) return null;
    const withAge = state.streams.map((s) => ({ s, sec: ageSeconds(s, now) })).filter((x): x is { s: (typeof state.streams)[number]; sec: number } => x.sec != null);
    return withAge.sort((a, b) => b.sec - a.sec)[0] ?? null;
  }, [state, now]);

  // Browser notification + beep, once per stream per threshold.
  useEffect(() => {
    if (!oldest) return;
    for (const [name, limit, text] of [
      ["amber", AMBER_SECONDS, "Stream is 3h30 old. Prepare to rotate the key."],
      ["red", RED_SECONDS, "Stream is 3h50 old. Rotate the stream key NOW."],
    ] as const) {
      const id = `${oldest.s.id}:${name}`;
      if (oldest.sec >= limit && !firedRef.current.has(id)) {
        firedRef.current.add(id);
        if (beepOn) beep();
        if (notifyOn && typeof Notification !== "undefined" && Notification.permission === "granted") new Notification("Astrotalk Live", { body: text });
      }
    }
  }, [oldest, beepOn, notifyOn]);

  if (!state) {
    return (
      <Page>
        <p className="text-[var(--muted)]">{offline ? S.ops.status.offline : "…"}</p>
      </Page>
    );
  }

  const workerAge = state.worker.lastSeen ? (now - new Date(state.worker.lastSeen).getTime()) / 1000 : Infinity;
  const workerDown = workerAge > 20;
  const tone = oldest ? (oldest.sec >= RED_SECONDS ? "red" : oldest.sec >= AMBER_SECONDS ? "amber" : "green") : "none";

  const act = async (path: string, body: Record<string, unknown> = {}) => {
    report(await opsAction(path, body));
    refresh();
  };

  const onAir = state.schedule.onAir;
  const next = state.schedule.next;

  return (
    <Page
      header={
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold sm:text-2xl">{S.ops.title}</h1>
            <p className="text-sm text-[var(--muted)]">{new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "medium" }).format(now)} IST</p>
          </div>
          <nav className="flex flex-wrap items-center gap-2" aria-label="Main">
            <span className={`badge ${workerDown ? "border-red-500 text-red-300" : ""}`}>
              <Dot ok={!workerDown} /> {S.ops.status.worker}: {workerDown ? "stopped" : S.ops.status.ok}
            </span>
            <span className={`badge ${!state.room.reachable ? "border-red-500 text-red-300" : ""}`}>
              <Dot ok={state.room.reachable} /> {S.ops.status.livekit}: {state.room.reachable ? S.ops.status.ok : "unreachable"}
            </span>
            <Link className="btn" href="/ops/schedule">
              {S.ops.nav.schedule}
            </Link>
            <button
              className="btn"
              onClick={async () => {
                await opsAction("/api/ops/logout");
                window.location.href = "/ops/login";
              }}
            >
              {S.ops.nav.logout}
            </button>
          </nav>
        </header>
      }
    >
      {/* ---------- alerts ---------- */}
      <div className="space-y-3" aria-live="polite">
        {offline && <Banner tone="amber">{S.ops.status.offline}</Banner>}
        {workerDown && <Banner tone="red">{S.ops.status.workerDown}</Banner>}
        {!state.room.reachable && <Banner tone="red">{S.ops.status.livekitDown}</Banner>}
        {state.alert && (
          <Banner tone="red">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <strong>{S.ops.stream.alertTitle}</strong> — {state.alert.label}
                {state.alert.reason && <span className="block text-sm opacity-90">{state.alert.reason}</span>}
                {!state.alert.canRestart && <span className="block text-sm opacity-90">{S.ops.stream.restartNeedsKey}</span>}
              </div>
              <div className="flex gap-2">
                {state.alert.canRestart && (
                  <button className="btn btn-primary" onClick={() => act("/api/ops/stream/restart", { sessionId: state.alert!.sessionId })}>
                    {S.ops.stream.restart}
                  </button>
                )}
                <button className="btn" onClick={() => act("/api/ops/stream/dismiss", { sessionId: state.alert!.sessionId })}>
                  {S.ops.stream.dismiss}
                </button>
              </div>
            </div>
          </Banner>
        )}
        {(tone === "amber" || tone === "red") && (
          <Banner tone={tone === "red" ? "red" : "amber"}>
            <strong>{S.ops.stream.rotateNow}</strong> — {oldest ? formatDuration(oldest.sec) : ""}
          </Banner>
        )}
        {toast && (
          <Banner tone={toast.ok ? "green" : "red"}>
            <div className="flex items-start justify-between gap-3">
              <span>{toast.message}</span>
              <button className="underline" onClick={() => setToast(null)}>
                OK
              </button>
            </div>
          </Banner>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ---------- left: who is on ---------- */}
        <div className="space-y-4">
          <section className="panel p-4 sm:p-5" aria-labelledby="now-h">
            <h2 id="now-h" className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
              {S.ops.now.title}
            </h2>
            {onAir ? (
              <div className="mt-2">
                <p className="text-2xl font-bold">{onAir.name}</p>
                {onAir.tagline && <p className="text-[var(--muted)]">{onAir.tagline}</p>}
                <p className="mt-2 font-mono text-4xl font-bold tabular-nums">
                  {formatDuration((new Date(onAir.endsAt).getTime() - now) / 1000)} <span className="text-base font-normal text-[var(--muted)]">{S.ops.now.left}</span>
                </p>
                <p className="mt-2 flex flex-wrap gap-2">
                  <span className={`badge ${onAir.connected ? "border-green-500/60" : "border-red-500 text-red-300"}`}>
                    <Dot ok={onAir.connected} /> {onAir.connected ? S.ops.greenRoom.connected : S.ops.greenRoom.notConnected}
                  </span>
                  {state.controls.mutedOnAir && <span className="badge border-amber-400 text-amber-300">Muted by ops</span>}
                </p>
              </div>
            ) : (
              <div className="mt-2">
                <p className="text-xl font-semibold">{S.ops.now.nobody}</p>
                <p className="text-[var(--muted)]">{S.ops.now.nobodyHelp}</p>
                {state.schedule.blockedCurrent && <p className="mt-1 text-sm text-amber-300">{S.ops.now.removedNote}</p>}
              </div>
            )}
          </section>

          <section className="panel p-4 sm:p-5" aria-labelledby="next-h">
            <h2 id="next-h" className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
              {S.ops.next.title}
            </h2>
            {next ? (
              <p className="mt-2 text-lg">
                <strong>{next.name}</strong> · {formatTimeIst(new Date(next.startsAt))} IST ·{" "}
                <span className="font-mono tabular-nums">{formatDuration((new Date(next.startsAt).getTime() - now) / 1000)}</span>{" "}
                <span className="text-[var(--muted)]">{S.ops.next.startsIn}</span>
              </p>
            ) : (
              <p className="mt-2 text-[var(--muted)]">{S.ops.next.none}</p>
            )}
          </section>

          <section className="panel p-4 sm:p-5" aria-labelledby="gr-h">
            <h2 id="gr-h" className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
              {S.ops.greenRoom.title}
            </h2>
            {state.schedule.greenRoom.length === 0 ? (
              <p className="mt-2 text-[var(--muted)]">{S.ops.greenRoom.none}</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {state.schedule.greenRoom.map((g) => (
                  <li key={g.shiftId} className="flex items-center justify-between gap-2">
                    <span>
                      {g.name} <span className="text-sm text-[var(--muted)]">{formatTimeIst(new Date(g.startsAt))}</span>
                    </span>
                    <span className={`badge ${g.connected ? "border-green-500/60" : "border-amber-400 text-amber-300"}`}>
                      <Dot ok={g.connected} /> {g.connected ? S.ops.greenRoom.connected : S.ops.greenRoom.notConnected}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel p-4 sm:p-5" aria-labelledby="ctl-h">
            <h2 id="ctl-h" className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
              {S.ops.controls.title}
            </h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <button className={`btn ${state.controls.transitionOn ? "btn-danger" : ""}`} onClick={() => act("/api/ops/transition", { on: !state.controls.transitionOn })} aria-pressed={state.controls.transitionOn}>
                {state.controls.transitionOn ? S.ops.controls.hideTransition : S.ops.controls.showTransition}
              </button>
              <button className="btn" onClick={() => act("/api/ops/mute", { on: !state.controls.mutedOnAir })} disabled={!onAir} aria-pressed={state.controls.mutedOnAir}>
                {state.controls.mutedOnAir ? S.ops.controls.unmute : S.ops.controls.mute}
              </button>
              <button className="btn" onClick={() => setConfirm("remove")} disabled={!onAir}>
                {S.ops.controls.remove}
              </button>
              <button className="btn" onClick={() => setConfirm("skip")} disabled={!next}>
                {S.ops.controls.skip}
              </button>
            </div>
            <p className="mt-2 text-xs text-[var(--muted)]">{state.controls.transitionOn ? S.ops.controls.transitionOn : S.ops.controls.transitionOff}</p>
          </section>
        </div>

        {/* ---------- right: stream ---------- */}
        <div className="space-y-4">
          <StreamPanel state={state} nowMs={now} transitionOn={state.controls.transitionOn} report={report} refresh={refresh} />

          <section className="panel space-y-2 p-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={notifyOn} onChange={(e) => { setNotifyOn(e.target.checked); writePref("opsNotify", e.target.checked); if (e.target.checked && typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission(); }} />
              {S.ops.stream.notifications}
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={beepOn} onChange={(e) => { setBeepOn(e.target.checked); writePref("opsBeep", e.target.checked); if (e.target.checked) beep(); }} />
              {S.ops.stream.beep}
            </label>
          </section>

          <TransitionVideoPanel report={report} />
          <Diagnostics state={state} />
        </div>
      </div>

      <EventLog state={state} />

      <ConfirmDialog open={confirm === "remove"} message={S.ops.controls.confirmRemove} onCancel={() => setConfirm(null)} onConfirm={() => { setConfirm(null); void act("/api/ops/remove"); }} />
      <ConfirmDialog open={confirm === "skip"} message={S.ops.controls.confirmSkip} danger={false} onCancel={() => setConfirm(null)} onConfirm={() => { setConfirm(null); void act("/api/ops/skip"); }} />
    </Page>
  );
}

function Diagnostics({ state }: { state: OpsSnapshot }) {
  const d = state.diagnostics;
  const hb = d.onAir?.heartbeat;
  const video = d.onAir?.serverSees.find((t) => t.kind === "video");
  const audioT = d.onAir?.serverSees.find((t) => t.kind === "audio");
  return (
    <section className="panel p-4 sm:p-5" aria-labelledby="diag-h">
      <h2 id="diag-h" className="text-lg font-semibold">
        {S.ops.diag.title}
      </h2>
      <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-[var(--muted)]">Running egresses</dt>
        <dd>{d.egressCount} <span className="text-[var(--muted)]">(recorders in room: {d.recorders})</span></dd>
        {state.streams.map((s) => (
          <FragmentRow key={s.id} label={`Stream “${s.label}”`} value={`${s.livekitStatus}${s.streamRetries ? `, ${s.streamRetries} reconnect tries` : ""}`} />
        ))}
        <dt className="text-[var(--muted)]">On-air person</dt>
        <dd>{d.onAir ? `${d.onAir.name} — ${d.onAir.connected ? "connected" : "NOT connected"}` : "nobody"}</dd>
        {d.onAir && (
          <>
            <FragmentRow label="Server receives video" value={video ? `${video.width}×${video.height} ${video.mime.replace("video/", "")}${video.muted ? " (muted)" : ""}` : "no video"} />
            <FragmentRow label="Server receives audio" value={audioT ? (audioT.muted ? "muted" : "yes") : "no audio"} />
            <FragmentRow label="May publish" value={d.onAir.canPublish ? "yes" : "no"} />
            <FragmentRow label="Connection quality" value={hb ? hb.quality : "no report yet"} />
            <FragmentRow label="Round-trip time" value={hb?.rttMs != null ? `${hb.rttMs} ms` : "—"} />
            <FragmentRow label="Upload bitrate" value={hb?.uplinkKbps != null ? `${hb.uplinkKbps} kbps` : "—"} />
            <FragmentRow label="Frame rate / size" value={hb?.fps != null ? `${Math.round(hb.fps)} fps, ${hb.width}×${hb.height}` : "—"} />
            {hb?.limitation && <FragmentRow label="Browser limiting quality due to" value={hb.limitation} />}
          </>
        )}
      </dl>
      <p className="mt-3 text-xs text-[var(--muted)]">Numbers about the astrologer’s connection are reported by their own browser every 5 seconds. LiveKit does not offer the outgoing bitrate/fps of the Instagram stream through its API; see your LiveKit Cloud dashboard (Egress) for that.</p>
    </section>
  );
}

function FragmentRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-[var(--muted)]">{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

function EventLog({ state }: { state: OpsSnapshot }) {
  return (
    <section className="panel p-4 sm:p-5" aria-labelledby="ev-h">
      <h2 id="ev-h" className="text-lg font-semibold">
        {S.ops.events.title}
      </h2>
      {state.events.length === 0 ? (
        <p className="mt-2 text-[var(--muted)]">{S.ops.events.none}</p>
      ) : (
        <ul className="mt-3 max-h-80 space-y-1 overflow-auto pr-1 text-sm">
          {state.events.map((e) => (
            <li key={e.id} className="flex gap-3">
              <time className="shrink-0 font-mono text-[var(--muted)]" dateTime={e.at}>
                {new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(e.at))}
              </time>
              <span className="badge shrink-0">{e.type}</span>
              <span className={/ALERT|could not|failed/i.test(e.message) ? "text-red-300" : ""}>{e.message}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Page({ children, header }: { children: React.ReactNode; header?: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-7xl space-y-4 px-4 py-5">
      {header}
      {children}
    </main>
  );
}

function Dot({ ok }: { ok: boolean }) {
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${ok ? "bg-green-500" : "bg-red-500"}`} aria-hidden />;
}

function Banner({ tone, children }: { tone: "red" | "amber" | "green"; children: React.ReactNode }) {
  const c = tone === "red" ? "border-red-500 bg-red-950/60 text-red-100" : tone === "amber" ? "border-amber-400 bg-amber-950/60 text-amber-100" : "border-green-500 bg-green-950/50 text-green-100";
  return (
    <div className={`rounded-xl border-2 px-4 py-3 ${c}`} role={tone === "red" ? "alert" : "status"}>
      {children}
    </div>
  );
}
