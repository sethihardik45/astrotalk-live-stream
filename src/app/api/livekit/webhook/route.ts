import { ParticipantInfo_Kind } from "@livekit/protocol";
import { WebhookReceiver } from "livekit-server-sdk";
import { db } from "@/lib/db";
import { reconcileEgress } from "@/lib/egressControl";
import { env } from "@/lib/env";
import { logEvent } from "@/lib/events";
import { guard, json } from "@/lib/http";
import { safeErrorMessage } from "@/lib/redact";

export const dynamic = "force-dynamic";

/**
 * POST /api/livekit/webhook — LiveKit tells us when things happen (egress started/ended, people joined/left).
 *
 * SECURITY: LiveKit signs every webhook with our API secret (a JWT in the Authorization header that also contains a hash of the
 * body). `WebhookReceiver.receive` verifies both. Anything unsigned or altered is rejected with 401. Note: it needs the RAW body text,
 * so we read `req.text()` and never parse JSON ourselves before verifying.
 *
 * What we do with the events: egress events trigger a status check (reconcileEgress), which updates StreamSession rows, raises the
 * "stopped unexpectedly" alert and performs the single automatic retry. Participant events go into the ops event log.
 * The ops page works even if webhooks are not configured (it re-checks itself every few seconds), they just make it faster.
 */
export const POST = guard("livekit/webhook", async (req: Request) => {
  const body = await req.text();
  const auth = req.headers.get("authorization") ?? undefined;

  let event;
  try {
    event = await new WebhookReceiver(env().LIVEKIT_API_KEY, env().LIVEKIT_API_SECRET).receive(body, auth);
  } catch (e) {
    console.warn("[webhook] rejected:", safeErrorMessage(e));
    return json({ error: "invalid_signature" }, 401);
  }

  switch (event.event) {
    case "egress_started":
    case "egress_updated":
    case "egress_ended":
      await reconcileEgress({ force: true });
      break;

    case "participant_joined":
    case "participant_left": {
      const p = event.participant;
      if (p && p.kind === ParticipantInfo_Kind.STANDARD) {
        const a = await db.astrologer.findUnique({ where: { id: p.identity }, select: { name: true } });
        await logEvent("participant", `${a?.name ?? p.identity} ${event.event === "participant_joined" ? "connected to" : "left"} the room`);
      }
      break;
    }

    default:
      break; // we ignore everything else
  }
  return json({ ok: true });
});
