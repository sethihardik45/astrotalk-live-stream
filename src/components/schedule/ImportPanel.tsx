"use client";

import { useState } from "react";
import { opsAction, type ActionResult } from "@/components/ops/useOps";
import { S } from "@/lib/strings";

interface Preview {
  committed: boolean;
  rows: number;
  astrologersToCreate: string[];
  shiftsToCreate: number;
  shiftsCreated?: number;
  errors: Array<{ line: number; message: string }>;
}

/** Bulk import astrologers and shifts from a CSV. First "Check the file" (nothing is saved), then "Import". */
export function ImportPanel({ report, refresh }: { report: (r: ActionResult) => void; refresh: () => void }) {
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(commit: boolean) {
    setBusy(true);
    const r = await opsAction("/api/ops/import", { csv, commit });
    setBusy(false);
    if (!r.ok) return report(r);
    const data = r.data as unknown as Preview;
    setResult(data);
    if (commit) {
      report({ ok: true, message: `Imported ${data.astrologersToCreate.length} new astrologers and ${data.shiftsCreated ?? 0} shifts.` });
      refresh();
    }
  }

  return (
    <section className="panel space-y-3 p-4 sm:p-5" aria-labelledby="imp-h">
      <div>
        <h2 id="imp-h" className="text-lg font-semibold">
          {S.schedule.import}
        </h2>
        <p className="text-sm text-[var(--muted)]">{S.schedule.importHelp}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <a className="btn" href="/sample-astrologers-shifts.csv" download>
          {S.schedule.sample}
        </a>
        <label className="btn cursor-pointer">
          {S.schedule.chooseFile}
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) {
                setCsv(await f.text());
                setResult(null);
              }
              e.target.value = "";
            }}
          />
        </label>
      </div>
      <label className="block text-sm">
        <span className="mb-1 block text-[var(--muted)]">{S.schedule.orPaste}</span>
        <textarea className="input min-h-28 font-mono text-xs" value={csv} onChange={(e) => { setCsv(e.target.value); setResult(null); }} spellCheck={false} />
      </label>
      <div className="flex gap-2">
        <button className="btn" onClick={() => run(false)} disabled={busy || !csv.trim()}>
          {S.schedule.preview}
        </button>
        <button className="btn btn-primary" onClick={() => run(true)} disabled={busy || !result || result.committed || (result.shiftsToCreate === 0 && result.astrologersToCreate.length === 0)}>
          {S.schedule.doImport}
        </button>
      </div>

      {result && (
        <div className="space-y-2 text-sm" role="status">
          <p>
            {result.rows} rows read · {result.astrologersToCreate.length} new astrologers{result.astrologersToCreate.length > 0 && ` (${result.astrologersToCreate.join(", ")})`} · {result.committed ? (result.shiftsCreated ?? 0) : result.shiftsToCreate} shifts {result.committed ? "created" : "ready to import"}
          </p>
          {result.errors.length > 0 && (
            <div className="rounded-lg border border-amber-400 bg-amber-950/40 p-3">
              <p className="mb-1 font-semibold text-amber-200">{result.errors.length} rows have problems and will be skipped:</p>
              <ul className="max-h-48 list-disc space-y-0.5 overflow-auto pl-5">
                {result.errors.map((e, i) => (
                  <li key={i}>
                    Line {e.line}: {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
