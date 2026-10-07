import { requireOps } from "@/lib/auth";
import { logEvent } from "@/lib/events";
import { guard, json } from "@/lib/http";
import { MAX_VIDEO_BYTES, removeTransitionVideo, saveTransitionVideo, sniffVideo } from "@/lib/media";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { DEFAULT_TRANSITION_URL, SETTING_KEYS, setSetting } from "@/lib/settings";
import { enforceOnce } from "@/lib/enforce";

export const dynamic = "force-dynamic";

/**
 * POST multipart/form-data  field "file"  -> replace the transition video with an uploaded MP4/WebM (max 60 MB)
 * POST multipart/form-data  field "reset" = "1" -> go back to the built-in default (/brand/transition.mp4)
 * POST multipart/form-data  field "url"  -> use a video from an address instead (https only, or a path on this site)
 */
export const POST = guard("ops/transition-video", async (req: Request) => {
  const auth = requireOps(req);
  if (!auth.ok) return auth.res;
  const rl = rateLimit(`upload:${clientIp(req)}`, 10, 60_000);
  if (!rl.ok) return json({ error: "too_many_requests" }, 429);

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_VIDEO_BYTES + 200_000) return json({ error: "refused", message: "That file is too big (limit 60 MB)." }, 413);

  const form = await req.formData();

  if (form.get("reset") === "1") {
    await removeTransitionVideo();
    await setSetting(SETTING_KEYS.transitionUrl, DEFAULT_TRANSITION_URL);
    await logEvent("control", "Transition video reset to the default");
    await enforceOnce().catch(() => {});
    return json({ ok: true, url: DEFAULT_TRANSITION_URL });
  }

  const url = form.get("url");
  if (typeof url === "string" && url.trim()) {
    const u = url.trim();
    if (!/^https:\/\/[^\s]+$/i.test(u) && !/^\/(?!\/)[A-Za-z0-9/_\-.]+$/.test(u)) {
      return json({ error: "refused", message: "Use an address that starts with https:// (or a path on this site)." }, 400);
    }
    await setSetting(SETTING_KEYS.transitionUrl, u);
    await logEvent("control", "Transition video address changed");
    await enforceOnce().catch(() => {});
    return json({ ok: true, url: u });
  }

  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "refused", message: "Please choose a video file." }, 400);
  if (file.size > MAX_VIDEO_BYTES) return json({ error: "refused", message: "That file is too big (limit 60 MB)." }, 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffVideo(bytes.subarray(0, 16));
  if (!kind) return json({ error: "refused", message: "That does not look like an MP4 or WebM video." }, 400);

  await saveTransitionVideo(bytes, kind);
  const served = `/api/media/transition?v=${Date.now()}`; // the ?v= makes browsers fetch the new file
  await setSetting(SETTING_KEYS.transitionUrl, served);
  await logEvent("control", `Transition video replaced (${Math.round(file.size / 1024)} KB)`);
  await enforceOnce().catch(() => {});
  return json({ ok: true, url: served });
});
