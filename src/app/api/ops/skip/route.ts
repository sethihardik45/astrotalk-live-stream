import { Empty, opsPost } from "@/lib/opsRoute";
import { skipToNext } from "@/lib/stageControl";

export const dynamic = "force-dynamic";

export const POST = opsPost("skip", Empty, async () => skipToNext());
