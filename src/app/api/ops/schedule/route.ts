import { opsGet } from "@/lib/opsRoute";
import { scheduleSnapshot } from "@/lib/adminData";
import { startOfIstDay } from "@/lib/time";

export const dynamic = "force-dynamic";

/** GET /api/ops/schedule?from=<ISO instant>&days=7 — everything the schedule screen shows for one date range. */
export const GET = opsGet("schedule", async ({ url }) => {
  const fromParam = url.searchParams.get("from");
  const parsed = fromParam ? new Date(fromParam) : new Date();
  const from = startOfIstDay(Number.isNaN(parsed.getTime()) ? new Date() : parsed);
  const days = Math.min(14, Math.max(1, Number(url.searchParams.get("days")) || 7));
  return scheduleSnapshot(from, days);
});
