import { createHmac, timingSafeEqual, createHash } from "node:crypto";
import { env } from "./env";
import { json } from "./http";

/**
 * Ops authentication (version 1: one shared password).
 *
 * How it works: logging in with the right password sets a cookie that contains an expiry time and a signature made with
 * SESSION_SECRET. The browser cannot forge or extend it. The cookie is httpOnly (JavaScript cannot read it), SameSite=Strict
 * (other websites cannot make the browser send it) and expires after 12 hours.
 *
 * FUTURE: to add real user accounts, only change `verifyLogin` (who may log in) and the payload in `createSession`
 * (put a user id in `sub`). Every route calls `requireOps`, so nothing else needs to change.
 */

export const COOKIE_NAME = "ops_session";
export const SESSION_HOURS = 12;

export interface OpsSession {
  /** Who is logged in. Always "ops" in version 1. */
  sub: string;
  /** Expiry, ms since epoch. */
  exp: number;
}

const b64 = (s: string) => Buffer.from(s).toString("base64url");
const sign = (payload: string) => createHmac("sha256", env().SESSION_SECRET).update(payload).digest("base64url");

function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb); // constant-time: timing cannot reveal the password
}

/** Version 1: a single shared password. Replace this function to support real users. */
export function verifyLogin(password: string): OpsSession | null {
  if (!safeEqual(password, env().OPS_PASSWORD)) return null;
  return { sub: "ops", exp: Date.now() + SESSION_HOURS * 3600_000 };
}

export function createSessionCookieValue(s: OpsSession): string {
  const payload = b64(JSON.stringify(s));
  return `${payload}.${sign(payload)}`;
}

export function parseSessionCookieValue(value: string | undefined | null, now = Date.now()): OpsSession | null {
  if (!value) return null;
  const [payload, sig] = value.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString()) as OpsSession;
    if (typeof s.exp !== "number" || s.exp <= now || typeof s.sub !== "string") return null;
    return s;
  } catch {
    return null;
  }
}

function cookieFromHeader(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}

export function sessionFromRequest(req: Request): OpsSession | null {
  return parseSessionCookieValue(cookieFromHeader(req.headers.get("cookie"), COOKIE_NAME));
}

/**
 * Extra protection against "cross-site request forgery" on top of SameSite=Strict: for anything that changes data, the
 * request must come from our own site (Origin header matches the Host we are served on).
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return req.method === "GET" || req.method === "HEAD"; // browsers always send Origin on POST
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Use at the top of every ops route: returns the session, or a ready-made error response. */
export function requireOps(req: Request): { ok: true; session: OpsSession } | { ok: false; res: Response } {
  if (!sameOrigin(req)) return { ok: false, res: json({ error: "bad_origin" }, 403) };
  const session = sessionFromRequest(req);
  if (!session) return { ok: false, res: json({ error: "unauthorized" }, 401) };
  return { ok: true, session };
}

export function sessionCookieHeader(value: string, maxAgeSeconds: number, secure: boolean): string {
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure ? "; Secure" : ""}`;
}

export function isSecureRequest(req: Request): boolean {
  const proto = req.headers.get("x-forwarded-proto");
  return proto ? proto === "https" : new URL(req.url).protocol === "https:";
}
