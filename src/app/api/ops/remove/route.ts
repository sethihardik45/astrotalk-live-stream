import { Empty, opsPost } from "@/lib/opsRoute";
import { removeFromStage } from "@/lib/stageControl";

export const dynamic = "force-dynamic";

export const POST = opsPost("remove", Empty, async () => {
  await removeFromStage();
});
