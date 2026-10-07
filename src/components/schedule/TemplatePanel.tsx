"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/ops/ConfirmDialog";
import { opsAction, type ActionResult } from "@/components/ops/useOps";
import { S } from "@/lib/strings";
import type { ScheduleAstrologer, ScheduleTemplate } from "./useSchedule";

const DAYS = [
  { n: 1, label: "Mon" },
  { n: 2, label: "Tue" },
  { n: 3, label: "Wed" },
  { n: 4, label: "Thu" },
  { n: 5, label: "Fri" },
  { n: 6, label: "Sat" },
  { n: 0, label: "Sun" },
];

/** Recurring slots like "Ravi, every day, 14:00 to 15:00". They are expanded into real shifts for the next 14 days. */
export function TemplatePanel({ templates, astrologers, report, refresh }: { templates: ScheduleTemplate[]; astrologers: ScheduleAstrologer[]; report: (r: ActionResult) => void; refresh: () => void }) {
  const [astrologerId, setAstrologerId] = useState("");
  const [startTime, setStartTime] = useState("14:00");
  const [length, setLength] = useState(60);
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [busy, setBusy] = useState(false);
  const [delId, setDelId] = useState<string | null>(null);
  const [alsoFuture, setAlsoFuture] = useState(true);

  const toggle = (n: number) => setDays((d) => (d.includes(n) ? d.filter((x) => x !== n) : [...d, n]));

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await opsAction("/api/ops/templates", { astrologerId: astrologerId || astrologers.find((a) => a.active)?.id, startTimeLocal: startTime, durationMinutes: Number(length), daysOfWeek: days });
    setBusy(false);
    if (r.ok) {
      const c = Number(r.data?.created ?? 0);
      const sk = Number(r.data?.skippedOverlap ?? 0);
      report({ ok: true, message: `Saved. ${c} shifts created${sk ? `, ${sk} skipped because they would overlap another shift` : ""}.` });
    } else report(r);
    refresh();
  }

  const describeDays = (d: number[]) => (d.length === 7 ? S.schedule.everyDay : DAYS.filter((x) => d.includes(x.n)).map((x) => x.label).join(", "));

  return (
    <section className="panel space-y-4 p-4 sm:p-5" aria-labelledby="tpl-h">
      <div>
        <h2 id="tpl-h" className="text-lg font-semibold">
          {S.schedule.templates}
        </h2>
        <p className="text-sm text-[var(--muted)]">{S.schedule.templatesHelp}</p>
      </div>

      {templates.length > 0 && (
        <ul className="divide-y divide-[var(--line)] text-sm">
          {templates.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className={t.enabled ? "" : "opacity-50"}>
                <strong>{t.name}</strong> · {t.startTimeLocal} IST · {t.durationMinutes} min · {describeDays(t.daysOfWeek)}
              </span>
              <span className="flex gap-1.5">
                <button
                  className="btn !min-h-9 !px-3 !py-1 text-sm"
                  onClick={async () => {
                    report(await opsAction(`/api/ops/templates/${t.id}`, { enabled: !t.enabled }, "PATCH"));
                    refresh();
                  }}
                >
                  {t.enabled ? S.schedule.deactivate : S.schedule.activate}
                </button>
                <button className="btn !min-h-9 !px-3 !py-1 text-sm" onClick={() => setDelId(t.id)}>
                  {S.schedule.deleteTemplate}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="space-y-3 rounded-xl border border-[var(--line)] p-4">
        <h3 className="font-semibold">{S.schedule.addTemplate}</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-sm sm:col-span-1">
            <span className="mb-1 block">{S.schedule.astrologer}</span>
            <select className="input" value={astrologerId || astrologers.find((a) => a.active)?.id || ""} onChange={(e) => setAstrologerId(e.target.value)}>
              {astrologers.filter((a) => a.active).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block">{S.schedule.startTime}</span>
            <input className="input" type="time" required value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block">{S.schedule.length}</span>
            <input className="input" type="number" min={15} max={720} step={15} required value={length} onChange={(e) => setLength(Number(e.target.value))} />
          </label>
        </div>
        <fieldset>
          <legend className="mb-1 text-sm">{S.schedule.days}</legend>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((d) => (
              <label key={d.n} className={`btn !min-h-9 !px-3 !py-1 text-sm ${days.includes(d.n) ? "!bg-[#4a3fc4]" : ""}`}>
                <input type="checkbox" className="sr-only" checked={days.includes(d.n)} onChange={() => toggle(d.n)} />
                {d.label}
              </label>
            ))}
            <button type="button" className="btn !min-h-9 !px-3 !py-1 text-sm" onClick={() => setDays([0, 1, 2, 3, 4, 5, 6])}>
              {S.schedule.everyDay}
            </button>
            <button type="button" className="btn !min-h-9 !px-3 !py-1 text-sm" onClick={() => setDays([1, 2, 3, 4, 5])}>
              {S.schedule.weekdays}
            </button>
          </div>
        </fieldset>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary" type="submit" disabled={busy || days.length === 0}>
            {S.schedule.addTemplate}
          </button>
          <button
            type="button"
            className="btn"
            onClick={async () => {
              const r = await opsAction("/api/ops/templates/expand");
              report(r.ok ? { ok: true, message: `${Number(r.data?.created ?? 0)} shifts created.` } : r);
              refresh();
            }}
          >
            {S.schedule.createNow}
          </button>
        </div>
      </form>

      <ConfirmDialog
        open={delId !== null}
        message={S.schedule.confirmDeleteTemplate}
        confirmLabel={S.schedule.deleteTemplate}
        onCancel={() => setDelId(null)}
        onConfirm={async () => {
          const id = delId!;
          setDelId(null);
          report(await opsAction(`/api/ops/templates/${id}`, { deleteFutureShifts: alsoFuture }, "DELETE"));
          refresh();
        }}
      />
      {delId && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={alsoFuture} onChange={(e) => setAlsoFuture(e.target.checked)} /> {S.schedule.alsoDeleteFuture}
        </label>
      )}
    </section>
  );
}
