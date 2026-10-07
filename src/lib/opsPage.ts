import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME, parseSessionCookieValue } from "./auth";

/** For ops PAGES (server components): bounce to the login page unless the session cookie is valid. */
export async function requireOpsPage(): Promise<void> {
  const jar = await cookies();
  if (!parseSessionCookieValue(jar.get(COOKIE_NAME)?.value)) redirect("/ops/login");
}
