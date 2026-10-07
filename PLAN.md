# Astrotalk Live Relay — implementation plan

(Written at the start of the build. Kept in the repo so you can see the reasoning. The README is the user-facing doc.)

## Key decisions (verified against installed SDK types, LiveKit docs, Oct 2026)

| Topic | Decision | Why |
|---|---|---|
| Stack | Next.js 16 (App Router), React 19, Tailwind 4, TypeScript 5.9, Prisma 6, zod, Vitest | Prisma 6 = classic, stable config. TypeScript pinned to 5.x because tooling around TS 7 is still settling. |
| One package | Web app and worker live in ONE `package.json`; worker is `worker/index.ts` run with `tsx`, importing `src/lib/*` | Simplest for a non-developer; "shares the Prisma client" is automatic. |
| Egress layout signals | Plain `console.log("START_RECORDING")` after we are connected and have rendered. We do NOT use `EgressHelper.setRoom()` | `setRoom()` logs `END_RECORDING` when the room disconnects, which would kill the 24/7 egress. We reconnect instead. |
| Egress API | `EgressClient.startRoomCompositeEgress(room, new StreamOutput({protocol: RTMP, urls:[url]}), {customBaseUrl, encodingOptions})` | Confirmed in `livekit-server-sdk@2.19` types. |
| Permissions | Token: `canPublish:false, canSubscribe:false, canPublishData:false`. Worker calls `updateParticipant(... permission {canPublish:true, canPublishSources:[CAMERA, MICROPHONE]})` for the on-air person only | Server-enforced; a tampered client holds a token that cannot publish. |
| Layout isolation | Layout page renders only the participant whose identity == `onAirIdentity` in ROOM METADATA | Second line of defence if permissions ever misbehave. |
| Overlap safety | Postgres `EXCLUDE USING gist (tstzrange(startsAt, endsAt) WITH &&)` added in a hand-written migration + code validation | Database-level guarantee that the shared stage is never double-booked. |
| Stream keys | Held in a `globalThis` Map in the web process only while an egress is active (needed for the one-time auto-retry), deleted on stop/confirm/after retry. Never DB, never logs. Redaction helper applied to all error text. | Matches section 8. Requires ONE web instance (documented). |
| Live ops data | Short polling (2 s) of `/api/ops/state` | "Keep it simple". Webhooks still update DB/event log. |
| Diagnostics | Astrologer page sends a 5 s heartbeat (connection quality, RTT, uplink bitrate/fps) to the server; ops sees it | LiveKit's API does not expose egress bitrate/fps; this is the honest available signal. |
| Room lifetime | Worker/ops create the room with a long `emptyTimeout` | So the egress is not kicked when nobody is connected (transition video period). |
| Time | All stored UTC; IST (+05:30, no DST) helpers hand-written and unit-tested | No timezone library needed. |

## Folder structure

```
AstroBS/
├─ README.md  PLAN.md  .env.example
├─ docker-compose.yml  docker-compose.dev.yml  Caddyfile  Dockerfile.web  Dockerfile.worker
├─ package.json  tsconfig.json  next.config.ts  vitest.config.ts  eslint.config.mjs
├─ prisma/
│  ├─ schema.prisma
│  ├─ migrations/…            (incl. hand-written no-overlap constraint)
│  └─ seed.ts                 (12 astrologers, 24 hourly shifts/day)
├─ public/brand/              logo.svg, transition.mp4 (placeholder, replaceable)
├─ worker/index.ts            2-second schedule enforcer
├─ scripts/                   expand-templates, dev-db (embedded Postgres, no Docker), make-transition
├─ tests/                     Vitest: schedule, templates, overlap, slug, rtmp, time, redact
└─ src/
   ├─ app/
   │  ├─ live/[slug]/         astrologer page (no login)
   │  ├─ egress-layout/       page LiveKit's headless Chrome renders
   │  ├─ ops/                 dashboard, login, schedule admin
   │  └─ api/                 live/{token,state,heartbeat}, ops/*, livekit/webhook, …
   ├─ components/
   └─ lib/
      ├─ schedule/            PURE: onAir.ts, templates.ts, overlap.ts   (unit-tested)
      ├─ time.ts slug.ts rtmp.ts redact.ts strings.ts env.ts db.ts
      ├─ livekit.ts           clients, token minting
      ├─ enforce.ts           "make the room match the schedule" (used by worker AND ops APIs)
      ├─ egressControl.ts     start / rotate / confirm / stop / retry (keys in memory)
      ├─ auth.ts ratelimit.ts events.ts settings.ts
```

## Milestones (each ends with typecheck + lint + tests + summary)

1. Setup, Prisma schema + overlap constraint, seed, pure schedule logic + tests
2. Token/state API, astrologer page: local preview, countdown, green room (non-publishing)
3. Worker + `enforce.ts`: grants/revokes, metadata, removal; astrologer goes on/off air
4. Egress layout page; ops login; stream start/stop
5. Rotate flow, transition toggle, 4-hour timer, alerts, webhooks, controls, diagnostics
6. Schedule admin: grid, templates, CSV, astrologer management
7. Hardening: rate limits, headers, redaction, error states, security review
8. Docker Compose + Caddy, README, acceptance checklist, final summary

## Verification limits (stated up front)
No Docker/Postgres on this Mac, and no LiveKit/Instagram credentials. I will use an embedded Postgres for real DB tests (incl. the overlap constraint). Anything needing a real LiveKit project, egress, or Instagram will be built to the documented API and marked "not verified" in the final summary.
