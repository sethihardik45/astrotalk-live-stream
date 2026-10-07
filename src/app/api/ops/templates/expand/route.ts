import { Empty, opsPost } from "@/lib/opsRoute";
import { expandTemplatesToDb } from "@/lib/shifts";

export const dynamic = "force-dynamic";

/** "Create shifts from recurring slots now". The worker also does this every hour. */
export const POST = opsPost("templates/expand", Empty, async () => expandTemplatesToDb(14));
