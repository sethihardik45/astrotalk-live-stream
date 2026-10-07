import type { Metadata } from "next";
import { EgressLayout } from "@/components/egress/EgressLayout";

// Opened by LiveKit's egress (a hidden Chrome), not by people. Keep it out of search engines.
export const metadata: Metadata = { title: "AstroTalk Stream", robots: { index: false, follow: false } };

export default function EgressLayoutPage() {
  return <EgressLayout />;
}
