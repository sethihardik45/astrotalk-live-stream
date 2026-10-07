import type { Metadata } from "next";
import { ScheduleAdmin } from "@/components/schedule/ScheduleAdmin";
import { requireOpsPage } from "@/lib/opsPage";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Astrotalk Live — Schedule", robots: { index: false, follow: false } };

export default async function SchedulePage() {
  await requireOpsPage();
  return <ScheduleAdmin />;
}
