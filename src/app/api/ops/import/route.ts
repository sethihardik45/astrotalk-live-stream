import { z } from "zod";
import { importCsv } from "@/lib/adminData";
import { opsPost } from "@/lib/opsRoute";

export const dynamic = "force-dynamic";

/** commit=false returns a preview (what WOULD happen and which rows have problems); commit=true does it. */
export const POST = opsPost("import", z.object({ csv: z.string().max(1_000_000), commit: z.boolean() }), async ({ body }) => importCsv(body.csv, body.commit));
