"use client";

import { useRef, useState } from "react";
import type { ActionResult } from "./useOps";

/** Replace the "we'll be right back" video shown while keys are rotated or nobody is scheduled. */
export function TransitionVideoPanel({ report }: { report: (r: ActionResult) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function send(form: FormData, okText: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/ops/transition-video", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      report(res.ok ? { ok: true, message: okText } : { ok: false, message: data.message ?? "Upload failed." });
    } catch {
      report({ ok: false, message: "Could not reach the server." });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <section className="panel space-y-3 p-4 sm:p-5" aria-labelledby="tv-h">
      <h2 id="tv-h" className="text-lg font-semibold">
        Transition video
      </h2>
      <p className="text-sm text-[var(--muted)]">
        Shown when nobody is scheduled, or when you press “Show transition video”. Use an MP4 or WebM, portrait 720×1280, up to 60 MB. It loops.
      </p>
      <div className="flex flex-wrap gap-2">
        <label className="btn cursor-pointer">
          {busy ? "Uploading…" : "Upload new video"}
          <input
            ref={fileRef}
            type="file"
            accept="video/mp4,video/webm"
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const form = new FormData();
              form.set("file", f);
              void send(form, "Transition video replaced.");
            }}
          />
        </label>
        <button
          className="btn"
          disabled={busy}
          onClick={() => {
            const form = new FormData();
            form.set("reset", "1");
            void send(form, "Back to the default transition video.");
          }}
        >
          Use the default
        </button>
      </div>
    </section>
  );
}
