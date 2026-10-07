/**
 * Runs once when the web server starts (Next.js "instrumentation" hook).
 *
 * It checks the Instagram stream's health every 5 seconds INSIDE the web process, because that process is the only one that
 * holds the stream key needed for the single automatic restart. This means a dropped stream is noticed and retried even when
 * nobody has the ops page open and even if the LiveKit webhook is not set up.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const g = globalThis as unknown as { __egressWatch?: boolean };
  if (g.__egressWatch) return; // dev mode reloads modules: start only one timer
  g.__egressWatch = true;

  const { reconcileEgress } = await import("./lib/egressControl");
  setInterval(() => {
    reconcileEgress().catch(() => {
      /* LiveKit or the database is briefly unreachable: try again next time */
    });
  }, 5000);
}
