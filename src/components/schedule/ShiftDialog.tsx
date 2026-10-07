"use client";

import { useEffect, useRef, useState } from "react";
import { S } from "@/lib/strings";
import { addDaysToKey, istDateKey, istParts, istToUtc } from "@/lib/time";
import { opsAction } from "@/components/ops/useOps";
import type { ScheduleAstrologer, ScheduleShift } from "./useSchedule";

const hhmm = (d: Date) => {
  const p = istParts(d);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
};

/** Add or edit one shift. Everything the person types is IST. */
export function ShiftDialog({
  open,
  astrologers,
  editing,
  defaultStart,
  onClose,
  onSaved,
}: {
  open: boolean;
  astrologers: ScheduleAstrologer[];
  editing: ScheduleShift | null;
  defaultStart: Date | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [astrologerId, setAstrologerId] = useState("");
  const [date, setDate] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [askDelete, setAskDelete] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  // Fill the form each time it opens.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setAskDelete(false);
    if (editing) {
      setAstrologerId(editing.astrologerId);
      setDate(istDateKey(new Date(editing.startsAt)));
      setStart(hhmm(new Date(editing.startsAt)));
      setEnd(hhmm(new Date(editing.endsAt)));
    } else {
      const s = defaultStart ?? new Date();
      setAstrologerId(astrologers.find((a) => a.active)?.id ?? "");
      setDate(istDateKey(s));
      setStart(hhmm(s));
      setEnd(hhmm(new Date(s.getTime() + 3_600_000)));
    }
  }, [open, editing, defaultStart, astrologers]);

  const endsNextDay = !!start && !!end && end <= start;

  function times() {
    const startsAt = istToUtc(date, start);
    const endsAt = istToUtc(endsNextDay ? addDaysToKey(date, 1) : date, end);
    return { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = { astrologerId, ...times() };
    const r = editing ? await opsAction(`/api/ops/shifts/${editing.id}`, body, "PATCH") : await opsAction("/api/ops/shifts", body);
    setBusy(false);
    if (r.ok) onSaved();
    else setError(r.message);
  }

  async function remove() {
    if (!editing) return;
    setBusy(true);
    const r = await opsAction(`/api/ops/shifts/${editing.id}`, {}, "DELETE");
    setBusy(false);
    if (r.ok) onSaved();
    else setError(r.message);
  }

  return (
    <dialog ref={ref} onCancel={onClose} onClose={onClose} className="m-auto w-[min(94vw,30rem)] rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-6 text-[var(--text)] backdrop:bg-black/70">
      <h2 className="mb-4 text-lg font-semibold">{editing ? S.schedule.editShift : S.schedule.addShift}</h2>
      <form onSubmit={save} className="space-y-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{S.schedule.astrologer}</span>
          <select className="input" required value={astrologerId} onChange={(e) => setAstrologerId(e.target.value)}>
            {astrologers
              .filter((a) => a.active || a.id === astrologerId)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.active ? "" : ` (${S.schedule.inactive})`}
                </option>
              ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{S.schedule.date}</span>
          <input className="input" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{S.schedule.start}</span>
            <input className="input" type="time" required step={60} value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{S.schedule.end}</span>
            <input className="input" type="time" required step={60} value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>
        {endsNextDay && <p className="text-sm text-[var(--muted)]">{S.schedule.endsNextDay}</p>}
        {error && (
          <p className="rounded-lg border border-red-500 bg-red-950/60 p-3 text-sm text-red-100" role="alert">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
          <div>
            {editing &&
              (askDelete ? (
                <span className="inline-flex items-center gap-2 text-sm">
                  {S.schedule.confirmDeleteShift}
                  <button type="button" className="btn btn-danger" onClick={remove} disabled={busy}>
                    {S.ops.controls.yes}
                  </button>
                </span>
              ) : (
                <button type="button" className="btn" onClick={() => setAskDelete(true)}>
                  {S.schedule.delete}
                </button>
              ))}
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn" onClick={onClose}>
              {S.ops.controls.cancel}
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {S.schedule.save}
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
