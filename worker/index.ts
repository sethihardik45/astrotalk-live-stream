/**
 * The schedule enforcer. A long-running process that, every 2 seconds, makes the LiveKit room match the schedule:
 * who may publish, what the layout page shows, who gets removed. See src/lib/enforce.ts for the rules.
 *
 * Run it with:  npm run worker      (in Docker it is the "worker" service)
 *
 * Safe to run twice by accident: every pass reads the real room state and only changes differences.
 * Safe to restart mid-shift: it keeps NO memory between passes. The database + the clock + LiveKit's state are the truth.
 */
import { db } from "../src/lib/db";
import { enforceOnce } from "../src/lib/enforce";
import { ensureRoom } from "../src/lib/livekit";
import { logEvent, pruneEvents } from "../src/lib/events";
import { safeErrorMessage } from "../src/lib/redact";
import { setSetting } from "../src/lib/settings";
import { expandTemplatesToDb } from "../src/lib/shifts";
import { pruneBlockedShifts } from "../src/lib/stage";

const TICK_MS = 2000;
const HOURLY_MS = 60 * 60 * 1000;

let stopping = false;
let lastHourly = 0;
let lastHeartbeat = 0;
let lastError = "";

async function tick() {
  const started = Date.now();
  try {
    const r = await enforceOnce(new Date());
    if (r.errors.length) {
      const msg = r.errors.join(" | ").slice(0, 300);
      if (msg !== lastError) console.warn("[worker] problems:", msg);
      lastError = msg;
    } else {
      lastError = "";
    }
    if (r.changed.length) console.log(`[worker] ${new Date().toISOString()} changed: ${r.changed.join(", ")}`);
  } catch (e) {
    const msg = safeErrorMessage(e);
    if (msg !== lastError) console.error("[worker] tick failed:", msg);
    lastError = msg;
  }

  // Tell the ops page we are alive (and if not, why). Every ~5 seconds is enough.
  if (Date.now() - lastHeartbeat > 5000) {
    lastHeartbeat = Date.now();
    await Promise.all([setSetting("workerHeartbeat", new Date().toISOString()), setSetting("workerError", lastError)]).catch(() => {});
  }

  // Housekeeping once an hour: create the next 14 days of shifts from templates, trim old logs.
  if (Date.now() - lastHourly > HOURLY_MS) {
    lastHourly = Date.now();
    try {
      const r = await expandTemplatesToDb(14);
      if (r.created) await logEvent("schedule", `Created ${r.created} shifts from templates`);
      await pruneEvents(1000);
      await pruneBlockedShifts();
    } catch (e) {
      console.error("[worker] housekeeping failed:", safeErrorMessage(e));
    }
  }

  const spent = Date.now() - started;
  if (spent > TICK_MS) console.warn(`[worker] slow pass: ${spent} ms`);
  return Math.max(200, TICK_MS - spent);
}

async function main() {
  console.log("[worker] starting");
  try {
    await ensureRoom();
  } catch (e) {
    console.error("[worker] could not create the LiveKit room (will keep trying):", safeErrorMessage(e));
  }
  await logEvent("system", "Worker started");

  const loop = async () => {
    if (stopping) return;
    const wait = await tick();
    setTimeout(loop, wait);
  };
  void loop();
}

async function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log("[worker] stopping");
  await logEvent("system", "Worker stopped");
  await db.$disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((e) => {
  console.error("[worker] fatal:", safeErrorMessage(e));
  process.exit(1);
});
