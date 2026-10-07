"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import type { ActionResult } from "@/components/ops/useOps";
import { S } from "@/lib/strings";
import { addDaysToKey } from "@/lib/time";
import { AstrologerPanel } from "./AstrologerPanel";
import { ImportPanel } from "./ImportPanel";
import { ShiftDialog } from "./ShiftDialog";
import { TemplatePanel } from "./TemplatePanel";
import { mondayKeyOf, useSchedule, type ScheduleShift } from "./useSchedule";
import { WeekGrid } from "./WeekGrid";

export function ScheduleAdmin() {
  const [mondayKey, setMondayKey] = useState(() => mondayKeyOf(new Date()));
  const { data, error, refresh } = useSchedule(mondayKey);
  const [toast, setToast] = useState<ActionResult | null>(null);
  const [dialog, setDialog] = useState<{ editing: ScheduleShift | null; start: Date | null } | null>(null);

  const report = useCallback((r: ActionResult) => {
    setToast(r);
    if (r.ok) setTimeout(() => setToast((t) => (t === r ? null : t)), 4000);
  }, []);

  const pct = data?.coverageNext7Days.percent ?? 0;
  const tone = pct >= 99.9 ? "border-green-500 text-green-300" : pct >= 80 ? "border-amber-400 text-amber-300" : "border-red-500 text-red-300";
  const thisMonday = mondayKeyOf(new Date());
  const rangeLabel = `${mondayKey} → ${addDaysToKey(mondayKey, 6)}`;

  return (
    <main className="mx-auto w-full max-w-7xl space-y-4 px-4 py-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl">{S.schedule.title}</h1>
          <p className="text-sm text-[var(--muted)]">{S.live.timeZoneNote}</p>
        </div>
        <Link className="btn" href="/ops">
          ← {S.schedule.back}
        </Link>
      </header>

      <div className="flex flex-wrap items-center gap-3" aria-live="polite">
        <span className={`badge !text-sm ${tone}`}>{S.schedule.coverage(pct)}</span>
        {data && <span className="text-sm text-[var(--muted)]">{data.coverageNext7Days.gapCount === 0 ? S.schedule.noGaps : S.schedule.gaps(data.coverageNext7Days.gapCount)}</span>}
        {data && data.overlaps.length > 0 && <span className="badge border-red-500 text-red-300">{data.overlaps.length} overlapping shifts — fix these!</span>}
      </div>

      {error && <p className="rounded-lg border border-amber-400 bg-amber-950/50 p-3 text-sm text-amber-100">{error}</p>}
      {toast && (
        <div className={`flex items-start justify-between gap-3 rounded-xl border-2 px-4 py-3 ${toast.ok ? "border-green-500 bg-green-950/50" : "border-red-500 bg-red-950/60"}`} role={toast.ok ? "status" : "alert"}>
          <span>{toast.message}</span>
          <button className="underline" onClick={() => setToast(null)}>
            OK
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button className="btn" onClick={() => setMondayKey((k) => addDaysToKey(k, -7))} aria-label={S.schedule.prev}>
          ←
        </button>
        <button className="btn" onClick={() => setMondayKey(thisMonday)} disabled={mondayKey === thisMonday}>
          {S.schedule.thisWeek}
        </button>
        <button className="btn" onClick={() => setMondayKey((k) => addDaysToKey(k, 7))} aria-label={S.schedule.next}>
          →
        </button>
        <span className="px-2 text-sm text-[var(--muted)]">{rangeLabel}</span>
        <button className="btn btn-primary ml-auto" onClick={() => setDialog({ editing: null, start: null })} disabled={!data}>
          + {S.schedule.addShift}
        </button>
      </div>

      {data ? (
        <WeekGrid data={data} mondayKey={mondayKey} onAdd={(start) => setDialog({ editing: null, start })} onEdit={(s) => setDialog({ editing: s, start: null })} />
      ) : (
        <p className="text-[var(--muted)]">…</p>
      )}

      {data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <AstrologerPanel astrologers={data.astrologers} report={report} refresh={refresh} />
          <div className="space-y-4">
            <TemplatePanel templates={data.templates} astrologers={data.astrologers} report={report} refresh={refresh} />
            <ImportPanel report={report} refresh={refresh} />
          </div>
        </div>
      )}

      <ShiftDialog
        open={dialog !== null}
        astrologers={data?.astrologers ?? []}
        editing={dialog?.editing ?? null}
        defaultStart={dialog?.start ?? null}
        onClose={() => setDialog(null)}
        onSaved={() => {
          setDialog(null);
          report({ ok: true, message: "Saved." });
          void refresh();
        }}
      />
    </main>
  );
}
