import { confirmSwitch, describeSession } from "@/lib/egressControl";
import { Empty, opsPost } from "@/lib/opsRoute";

export const dynamic = "force-dynamic";

export const POST = opsPost("stream/confirm-switch", Empty, async () => {
  const s = await confirmSwitch();
  return { session: describeSession(s) };
});
