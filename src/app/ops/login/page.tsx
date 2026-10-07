import type { Metadata } from "next";
import { LoginForm } from "@/components/ops/LoginForm";

export const metadata: Metadata = { title: "Team login", robots: { index: false, follow: false } };

export default function LoginPage() {
  return <LoginForm />;
}
