import { requireOps } from "@/lib/auth";
import { guard, json } from "@/lib/http";
import { getOpsSnapshot } from "@/lib/opsState";

export const dynamic = "force-dynamic";

/** GET /api/ops/state — everything the dashboard shows. Polled every 2 seconds by the page. */
export const GET = guard("ops/state", async (req: Request) => {
  const auth = requireOps(req);
  if (!auth.ok) return auth.res;
  return json(await getOpsSnapshot());
});
