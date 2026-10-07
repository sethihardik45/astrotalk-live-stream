"use client";

import { useState } from "react";
import { S } from "@/lib/strings";

export function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ops/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
      if (res.ok) {
        window.location.href = "/ops";
        return;
      }
      setError(res.status === 401 ? S.ops.login.wrong : res.status === 429 ? S.ops.login.tooMany : S.ops.login.error);
    } catch {
      setError(S.ops.login.error);
    } finally {
      setBusy(false);
      setPassword("");
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-bold">{S.ops.login.title}</h1>
      <form onSubmit={submit} className="panel space-y-4 p-5">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{S.ops.login.password}</span>
          <input className="input" type="password" required autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && (
          <p className="text-sm text-red-300" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn-primary w-full" type="submit" disabled={busy}>
          {S.ops.login.submit}
        </button>
      </form>
    </main>
  );
}
