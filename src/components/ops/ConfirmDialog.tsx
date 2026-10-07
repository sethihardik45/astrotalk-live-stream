"use client";

import { useEffect, useRef } from "react";
import { S } from "@/lib/strings";

/** An "are you sure?" box built on the browser's own <dialog>, so keyboard and screen readers work properly. */
export function ConfirmDialog({
  open,
  message,
  confirmLabel = S.ops.controls.yes,
  danger = true,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog ref={ref} onCancel={onCancel} className="m-auto w-[min(92vw,28rem)] rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-6 text-[var(--text)] backdrop:bg-black/70">
      <p className="text-base">{message}</p>
      <div className="mt-5 flex justify-end gap-3">
        <button className="btn" onClick={onCancel} autoFocus>
          {S.ops.controls.cancel}
        </button>
        <button className={`btn ${danger ? "btn-danger" : "btn-primary"}`} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
