import { z } from "zod";

/**
 * All configuration comes from environment variables (see .env.example).
 * Parsed lazily so `next build` in Docker works without secrets present.
 *
 * Server-only secrets (LIVEKIT_API_SECRET, OPS_PASSWORD, SESSION_SECRET) must never be imported into
 * client components. Only NEXT_PUBLIC_* values are available in the browser.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  LIVEKIT_URL: z.string().min(1),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
  NEXT_PUBLIC_LIVEKIT_URL: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  OPS_PASSWORD: z.string().min(8, "OPS_PASSWORD must be at least 8 characters"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  ROOM_NAME: z.string().min(1).default("astrotalk-live"),
  GREEN_ROOM_LEAD_MINUTES: z.coerce.number().int().min(1).max(120).default(10),
  HANDOFF_GRACE_SECONDS: z.coerce.number().int().min(0).max(600).default(30),
  TZ_DISPLAY: z.string().default("Asia/Kolkata"),
  /** Where uploaded files (the transition video) are kept. In Docker this is a persistent volume. */
  UPLOAD_DIR: z.string().default("./data/uploads"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Missing or invalid environment variables:\n${problems}\n(See .env.example)`);
  }
  cached = parsed.data;
  return cached;
}

/** The LiveKit server SDK wants an http(s) URL; people paste wss://. Accept both. */
export function livekitHttpUrl(): string {
  return env().LIVEKIT_URL.replace(/^wss:/i, "https:").replace(/^ws:/i, "http:").replace(/\/+$/, "");
}
