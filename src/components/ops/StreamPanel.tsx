"use client";

import { useEffect, useRef, useState } from "react";
import type { OpsSnapshot } from "@/lib/opsState";
import { S } from "@/lib/strings";
import { ageTone, streamAgeSeconds } from "@/lib/streamAge";
import { formatDuration } from "@/lib/time";
import { ConfirmDialog } from "./ConfirmDialog";
import { opsAction, type ActionResult } from "./useOps";

type Stream = OpsSnapshot["streams"][number];

/** Stream age for one stream (null while it is only a preview). */
export const ageSeconds = (s: Stream, nowMs: number) => streamAgeSeconds(s.liveAt, nowMs);

const toneClass = { none: "text-[var(--muted)]", green: "text-green-400", amber: "text-amber-300", red: "text-red-400" };
const toneBorder = { none: "border-[var(--line)]", green: "border-green-500/50", amber: "border-amber-400", red: "border-red-500" };

export function StreamPanel({
  state,
  platform,
  nowMs,
  transitionOn,
  report,
  refresh,
}: {
  state: OpsSnapshot;
  platform: "instagram" | "youtube" | "other";
  nowMs: number;
  transitionOn: boolean;
  report: (r: ActionResult) => void;
  refresh: () => void;
}) {
  const P = S.ops.stream.platforms[platform];
  const live = state.streams.filter((x) => x.platform === platform);
  const alert = state.alerts.find((a) => a.platform === platform);
  const rotating = live.length >= 2;

  // The Server URL is not secret, so we remember the last one for convenience. The stream key is NEVER remembered.
  const [serverUrl, setServerUrl] = useState("");
  const [streamKey, setStreamKey] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmStop, setConfirmStop] = useState<string | null>(null);
  const keyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      setServerUrl(localStorage.getItem(`lastServerUrl:${platform}`) ?? "");
    } catch {
      /* storage may be blocked; fine */
    }
  }, [platform]);

  async function submit(path: "/api/ops/stream/start" | "/api/ops/stream/rotate") {
    const key = streamKey;
    setStreamKey(""); // cleared the moment you press the button, whatever happens next
    if (keyRef.current) keyRef.current.value = "";
    setBusy(true);
    try {
      // Only remember something that looks like a plain server address. If someone pasted the whole URL including the key
      // into this box by mistake, it must never be saved in the browser.
      const u = serverUrl.trim();
      if (/^rtmps?:\/\/[^/?\s]+(\/[A-Za-z0-9_-]{0,12}\/?)?$/i.test(u)) localStorage.setItem(`lastServerUrl:${platform}`, u);
    } catch {
      /* ignore */
    }
    const r = await opsAction(path, { serverUrl, streamKey: key, label: label || undefined, platform });
    setBusy(false);
    report(r.ok ? { ok: true, message: path.endsWith("start") ? "Stream is starting." : "New stream is starting next to the old one." } : r);
    if (r.ok) setLabel("");
    refresh();
  }

  const destinationForm = (
    <form
      className="space-y-3"
      autoComplete="off"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(live.length === 0 ? "/api/ops/stream/start" : "/api/ops/stream/rotate");
      }}
    >
      <label className="block text-sm">
        <span className="mb-1 block font-medium">{S.ops.stream.serverUrl}</span>
        <input className="input" type="text" inputMode="url" required value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} placeholder={P.serverUrlHint} autoComplete="off" spellCheck={false} />
        <span className="text-xs text-[var(--muted)]">{P.help}</span>
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">{S.ops.stream.streamKey}</span>
        <input ref={keyRef} className="input" type="password" required value={streamKey} onChange={(e) => setStreamKey(e.target.value)} autoComplete="new-password" spellCheck={false} data-1p-ignore data-lpignore="true" />
        <span className="text-xs text-[var(--muted)]">{S.ops.stream.streamKeyHelp}</span>
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">{S.ops.stream.label}</span>
        <input className="input" type="text" maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} autoComplete="off" />
      </label>
      <button className="btn btn-primary w-full" type="submit" disabled={busy}>
        {busy ? "…" : live.length === 0 ? S.ops.stream.start : S.ops.stream.rotateStart}
      </button>
    </form>
  );

  return (
    <section className="panel space-y-4 p-4 sm:p-5" aria-labelledby={`stream-h-${platform}`}>
      <h2 id={`stream-h-${platform}`} className="text-lg font-semibold">
        {S.ops.stream.streamTitle(P.name)}
      </h2>

      {/* Running streams */}
      {live.length === 0 && <p className="text-[var(--muted)]">{S.ops.stream.none}</p>}
      {live.map((s) => {
        const sec = ageSeconds(s, nowMs);
        // Only Instagram has the 4-hour limit; other platforms just show how long they have been running.
        const tone = platform === "instagram" ? ageTone(sec) : sec == null ? "none" : "green";
        return (
          <div key={s.id} className={`rounded-xl border-2 p-4 ${toneBorder[tone]}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-semibold">{s.label}</p>
                <p className="text-sm text-[var(--muted)]">
                  <span className="badge mr-2">{S.ops.stream.status[s.status] ?? s.status}</span>
                  LiveKit: {s.livekitStatus}
                  {s.streamRetries > 0 && ` · retries ${s.streamRetries}`}
                </p>
                {s.streamError && <p className="text-sm text-red-300">{s.streamError}</p>}
              </div>
              <div className="text-right">
                {sec == null ? (
                  <p className="text-sm text-[var(--muted)]">{S.ops.stream.preview}</p>
                ) : (
                  <>
                    <p className="text-xs text-[var(--muted)]">{S.ops.stream.age}</p>
                    <p className={`font-mono text-3xl font-bold tabular-nums ${toneClass[tone]}`}>{formatDuration(sec)}</p>
                  </>
                )}
              </div>
            </div>
            <div className="mt-3 flex justify-end">
              <button className="btn btn-danger" onClick={() => setConfirmStop(s.id)}>
                {S.ops.stream.stop}
              </button>
            </div>
          </div>
        );
      })}

      {/* Rotation steps */}
      {rotating && (
        <div className="rounded-xl border border-sky-500/50 bg-sky-950/30 p-4">
          <h3 className="font-semibold text-sky-200">{S.ops.stream.steps.title}</h3>
          <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm">
            <li>{S.ops.stream.steps.s1(P.tool)}</li>
            <li>{S.ops.stream.steps.s2(P.name)}</li>
            <li>{S.ops.stream.steps.s3}</li>
          </ol>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <button
              className={`btn ${transitionOn ? "btn-danger" : ""}`}
              onClick={async () => {
                report(await opsAction("/api/ops/transition", { on: !transitionOn }));
                refresh();
              }}
            >
              {transitionOn ? S.ops.controls.hideTransition : S.ops.controls.showTransition}
            </button>
            <button
              className="btn btn-primary"
              onClick={async () => {
                const r = await opsAction("/api/ops/stream/confirm-switch", { platform });
                report(r.ok ? { ok: true, message: "Switched. The old stream was stopped." } : r);
                refresh();
              }}
            >
              {S.ops.stream.confirmSwitch}
            </button>
          </div>
        </div>
      )}

      {/* Start / rotate form */}
      {!rotating && (
        <div className="rounded-xl border border-[var(--line)] p-4">
          {live.length > 0 && (
            <div className="mb-3">
              <h3 className="font-semibold">{S.ops.stream.rotateTitle}</h3>
              <p className="text-sm text-[var(--muted)]">{S.ops.stream.rotateHelp}</p>
            </div>
          )}
          {alert && !alert.canRestart && live.length === 0 && <p className="mb-3 text-sm text-amber-300">{S.ops.stream.restartNeedsKey}</p>}
          {destinationForm}
        </div>
      )}

      <ConfirmDialog
        open={confirmStop !== null}
        message={S.ops.stream.confirmStop}
        confirmLabel={S.ops.stream.stop}
        onCancel={() => setConfirmStop(null)}
        onConfirm={async () => {
          const id = confirmStop;
          setConfirmStop(null);
          report(await opsAction("/api/ops/stream/stop", { sessionId: id ?? undefined }));
          refresh();
        }}
      />
    </section>
  );
}
