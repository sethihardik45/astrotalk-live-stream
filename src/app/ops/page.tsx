import type { Metadata } from "next";
import { OpsDashboard } from "@/components/ops/OpsDashboard";
import { requireOpsPage } from "@/lib/opsPage";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Astrotalk Live — Ops", robots: { index: false, follow: false } };

export default async function OpsPage() {
  await requireOpsPage();
  return <OpsDashboard />;
}
