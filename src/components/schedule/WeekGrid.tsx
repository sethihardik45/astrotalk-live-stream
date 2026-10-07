"use client";

import { addDaysToKey, formatTimeIst, istToUtc } from "@/lib/time";
import { S } from "@/lib/strings";
import type { ScheduleShift, ScheduleSnapshot } from "./useSchedule";

const HOUR_PX = 44;
const MS_HOUR = 3_600_000;
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** A stable pastel-ish colour per astrologer, so the same person always looks the same. */
function colourFor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return { bg: `hsl(${h} 45% 28%)`, border: `hsl(${h} 60% 55%)` };
}

/**
 * The 24 hours x 7 days weekly grid (all times IST).
 *  - click an EMPTY hour to add a shift there; click a block to edit or delete it
 *  - red hatched areas are gaps (nobody scheduled); a red outline means two shifts overlap
 * Drag-to-move is not built; use the edit dialog.
 */
export function WeekGrid({
  data,
  mondayKey,
  onAdd,
  onEdit,
}: {
  data: ScheduleSnapshot;
  mondayKey: string;
  onAdd: (startsAt: Date) => void;
  onEdit: (s: ScheduleShift) => void;
}) {
  const now = new Date(data.serverNow).getTime();
  const overlapIds = new Set(data.overlaps.flat());
  const days = Array.from({ length: 7 }, (_, i) => {
    const key = addDaysToKey(mondayKey, i);
    const start = istToUtc(key, "00:00");
    return { key, start, end: new Date(start.getTime() + 24 * MS_HOUR), label: DAY_NAMES[i], dayNum: Number(key.slice(8)) };
  });

  return (
    <div className="panel overflow-x-auto">
      <div className="grid min-w-[760px] grid-cols-[3.2rem_repeat(7,minmax(0,1fr))]">
        {/* header row */}
        <div className="sticky top-0 z-10 border-b border-[var(--line)] bg-[var(--panel)]" />
        {days.map((d) => {
          const isToday = now >= d.start.getTime() && now < d.end.getTime();
          return (
            <div key={d.key} className={`sticky top-0 z-10 border-b border-l border-[var(--line)] bg-[var(--panel)] p-2 text-center text-sm font-semibold ${isToday ? "text-[#c4b8ff]" : ""}`}>
              {d.label} {d.dayNum}
              {isToday && <span className="ml-1 text-xs font-normal">(today)</span>}
            </div>
          );
        })}

        {/* hour labels */}
        <div className="relative" style={{ height: 24 * HOUR_PX }}>
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="absolute right-1 -translate-y-2 text-[11px] text-[var(--muted)]" style={{ top: h * HOUR_PX }}>
              {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
            </div>
          ))}
        </div>

        {/* day columns */}
        {days.map((d) => {
          const dayShifts = data.shifts.filter((s) => new Date(s.startsAt).getTime() < d.end.getTime() && new Date(s.endsAt).getTime() > d.start.getTime());
          const dayGaps = data.gaps.filter((g) => new Date(g.startsAt).getTime() < d.end.getTime() && new Date(g.endsAt).getTime() > d.start.getTime());
          const nowTop = now >= d.start.getTime() && now < d.end.getTime() ? ((now - d.start.getTime()) / MS_HOUR) * HOUR_PX : null;
          return (
            <div key={d.key} className="relative border-l border-[var(--line)]" style={{ height: 24 * HOUR_PX }}>
              {/* clickable empty hours */}
              {Array.from({ length: 24 }, (_, h) => {
                const hourStart = new Date(d.start.getTime() + h * MS_HOUR);
                const past = hourStart.getTime() + MS_HOUR <= now;
                return (
                  <button
                    key={h}
                    type="button"
                    tabIndex={-1}
                    aria-label={`${S.schedule.addShift}: ${d.label} ${d.dayNum}, ${String(h).padStart(2, "0")}:00`}
                    onClick={() => onAdd(hourStart)}
                    className={`absolute left-0 right-0 border-t border-[var(--line)]/60 hover:bg-white/5 ${past ? "bg-black/30" : ""}`}
                    style={{ top: h * HOUR_PX, height: HOUR_PX }}
                  />
                );
              })}

              {/* gaps */}
              {dayGaps.map((g, i) => {
                const s = Math.max(new Date(g.startsAt).getTime(), d.start.getTime());
                const e = Math.min(new Date(g.endsAt).getTime(), d.end.getTime());
                return (
                  <div
                    key={i}
                    aria-hidden
                    className="pointer-events-none absolute left-0 right-0 border-y border-dashed border-red-500/70"
                    style={{
                      top: ((s - d.start.getTime()) / MS_HOUR) * HOUR_PX,
                      height: ((e - s) / MS_HOUR) * HOUR_PX,
                      background: "repeating-linear-gradient(135deg, rgba(239,68,68,0.20) 0 6px, rgba(239,68,68,0.06) 6px 12px)",
                    }}
                  />
                );
              })}

              {/* shifts */}
              {dayShifts.map((sh) => {
                const s = Math.max(new Date(sh.startsAt).getTime(), d.start.getTime());
                const e = Math.min(new Date(sh.endsAt).getTime(), d.end.getTime());
                const c = colourFor(sh.astrologerId);
                const bad = overlapIds.has(sh.id);
                return (
                  <button
                    key={sh.id + d.key}
                    type="button"
                    onClick={() => onEdit(sh)}
                    className={`absolute left-0.5 right-0.5 overflow-hidden rounded-md px-1.5 py-0.5 text-left text-xs leading-tight text-white ${bad ? "outline outline-2 outline-red-500" : ""} ${sh.active ? "" : "opacity-60"}`}
                    style={{ top: ((s - d.start.getTime()) / MS_HOUR) * HOUR_PX + 1, height: Math.max(18, ((e - s) / MS_HOUR) * HOUR_PX - 2), background: c.bg, border: `1px solid ${c.border}` }}
                    title={`${sh.name} ${formatTimeIst(new Date(sh.startsAt))}–${formatTimeIst(new Date(sh.endsAt))}${sh.active ? "" : " — " + S.schedule.inactiveNote}`}
                  >
                    <span className="block truncate font-semibold">{sh.name}</span>
                    <span className="block truncate opacity-80">
                      {formatTimeIst(new Date(sh.startsAt))}–{formatTimeIst(new Date(sh.endsAt))}
                      {bad ? " · OVERLAP" : ""}
                    </span>
                  </button>
                );
              })}

              {nowTop !== null && <div aria-hidden className="pointer-events-none absolute left-0 right-0 z-[5] h-0.5 bg-[#c4b8ff]" style={{ top: nowTop }} />}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-4 border-t border-[var(--line)] p-2 text-xs text-[var(--muted)]">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-5 border border-dashed border-red-500" style={{ background: "rgba(239,68,68,0.25)" }} /> {S.schedule.legendGap}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-5 rounded-sm outline outline-2 outline-red-500" /> {S.schedule.legendOverlap}
        </span>
      </div>
    </div>
  );
}
