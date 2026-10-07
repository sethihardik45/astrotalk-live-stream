"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/ops/ConfirmDialog";
import { opsAction, type ActionResult } from "@/components/ops/useOps";
import { S } from "@/lib/strings";
import { copyText, type ScheduleAstrologer } from "./useSchedule";

/** Add / edit / switch off astrologers, copy their secret link, make a new link. */
export function AstrologerPanel({ astrologers, report, refresh }: { astrologers: ScheduleAstrologer[]; report: (r: ActionResult) => void; refresh: () => void }) {
  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [regenId, setRegenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await opsAction("/api/ops/astrologers", { name, tagline: tagline || null, photoUrl });
    setBusy(false);
    report(r.ok ? { ok: true, message: `${name} added. Use “${S.schedule.copyMessage}” to send them their link.` } : r);
    if (r.ok) {
      setName("");
      setTagline("");
      setPhotoUrl("");
      refresh();
    }
  }

  async function copy(text: string) {
    report((await copyText(text)) ? { ok: true, message: S.schedule.copied } : { ok: false, message: "Could not copy. Please select the link and copy it by hand." });
  }

  return (
    <section className="panel space-y-4 p-4 sm:p-5" aria-labelledby="astro-h">
      <h2 id="astro-h" className="text-lg font-semibold">
        {S.schedule.astrologers}
      </h2>
      <ul className="divide-y divide-[var(--line)]">
        {astrologers.map((a) =>
          editId === a.id ? (
            <EditRow key={a.id} a={a} onDone={() => { setEditId(null); refresh(); }} report={report} />
          ) : (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {a.name} {!a.active && <span className="badge border-amber-400 text-amber-300">{S.schedule.inactive}</span>}
                </p>
                {a.tagline && <p className="truncate text-sm text-[var(--muted)]">{a.tagline}</p>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button className="btn !min-h-9 !px-3 !py-1 text-sm" onClick={() => copy(a.link)}>
                  {S.schedule.copyLink}
                </button>
                <button className="btn !min-h-9 !px-3 !py-1 text-sm" onClick={() => copy(S.schedule.whatsapp(a.name, a.link))}>
                  {S.schedule.copyMessage}
                </button>
                <button className="btn !min-h-9 !px-3 !py-1 text-sm" onClick={() => setRegenId(a.id)}>
                  {S.schedule.regenerate}
                </button>
                <button className="btn !min-h-9 !px-3 !py-1 text-sm" onClick={() => setEditId(a.id)}>
                  {S.schedule.edit}
                </button>
                <button
                  className="btn !min-h-9 !px-3 !py-1 text-sm"
                  onClick={async () => {
                    report(await opsAction(`/api/ops/astrologers/${a.id}`, { active: !a.active }, "PATCH"));
                    refresh();
                  }}
                >
                  {a.active ? S.schedule.deactivate : S.schedule.activate}
                </button>
              </div>
            </li>
          ),
        )}
      </ul>

      <form onSubmit={add} className="space-y-3 rounded-xl border border-[var(--line)] p-4">
        <h3 className="font-semibold">{S.schedule.addAstrologer}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block">{S.schedule.name}</span>
            <input className="input" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block">{S.schedule.tagline}</span>
            <input className="input" maxLength={120} value={tagline} onChange={(e) => setTagline(e.target.value)} />
          </label>
        </div>
        <label className="block text-sm">
          <span className="mb-1 block">{S.schedule.photoUrl}</span>
          <input className="input" type="url" value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} />
        </label>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {S.schedule.addAstrologer}
        </button>
      </form>

      <ConfirmDialog
        open={regenId !== null}
        message={S.schedule.confirmRegenerate}
        confirmLabel={S.schedule.regenerate}
        onCancel={() => setRegenId(null)}
        onConfirm={async () => {
          const id = regenId!;
          setRegenId(null);
          const r = await opsAction(`/api/ops/astrologers/${id}/regenerate`);
          const link = (r.data?.link as string | undefined) ?? "";
          if (r.ok && link) await copyText(link);
          report(r.ok ? { ok: true, message: "New link created and copied. The old link no longer works." } : r);
          refresh();
        }}
      />
    </section>
  );
}

function EditRow({ a, onDone, report }: { a: ScheduleAstrologer; onDone: () => void; report: (r: ActionResult) => void }) {
  const [name, setName] = useState(a.name);
  const [tagline, setTagline] = useState(a.tagline ?? "");
  const [photoUrl, setPhotoUrl] = useState(a.photoUrl ?? "");
  return (
    <li className="space-y-2 py-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <input className="input" aria-label={S.schedule.name} value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input" aria-label={S.schedule.tagline} value={tagline} onChange={(e) => setTagline(e.target.value)} />
        <input className="input" aria-label={S.schedule.photoUrl} type="url" value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <button
          className="btn btn-primary"
          onClick={async () => {
            const r = await opsAction(`/api/ops/astrologers/${a.id}`, { name, tagline: tagline || null, photoUrl }, "PATCH");
            report(r);
            if (r.ok) onDone();
          }}
        >
          {S.schedule.save}
        </button>
        <button className="btn" onClick={onDone}>
          {S.ops.controls.cancel}
        </button>
      </div>
    </li>
  );
}
