# AstroTalk Live Relay

Put scheduled astrologers on the AstroTalk Instagram Live **from a link in their browser** — no Instagram login, no software to install.

- Astrologers open their personal link, check camera and mic, and wait.
- At their slot start the server puts them on air by itself. At slot end the next astrologer takes over, and the Instagram stream does not stop.
- Your team pastes an Instagram **Server URL + Stream key** into the ops console (about every 4 hours, because Instagram ends a Live after 4 hours). Nothing else needs doing.

This guide is written for non-developers. Every command can be copied and pasted. Where a screen is described, the words in **bold** are what you click.

**Contents**
1. [How it works](#1-how-it-works)
2. [What you need](#2-what-you-need)
3. [Get your LiveKit keys](#3-get-your-livekit-keys)
4. [Run it on your own computer](#4-run-it-on-your-own-computer-with-a-tunnel)
5. [Run the tests](#5-run-the-tests)
6. [Put it on a server (production)](#6-put-it-on-a-server-production)
7. [Day-to-day guide for the ops team](#7-day-to-day-guide-for-the-ops-team)
8. [Troubleshooting](#8-troubleshooting)
9. [Delay: where the seconds go](#9-delay-where-the-seconds-go)
10. [Acceptance checklist](#10-acceptance-checklist)
11. [Security notes](#11-security-notes)
12. [What is where in the code](#12-what-is-where-in-the-code)
13. [Known limits](#13-known-limits)

---

## 1. How it works

```
 Astrologer's browser                 (their personal link:  https://YOUR-DOMAIN/live/<secret>)
   │  check camera/mic, wait in the green room
   │  WebRTC (very low delay) — video is only ACCEPTED while it is their turn
   ▼
 LiveKit server  ── one fixed room "astrotalk-live" ──────────────┐
   ▲                                                              │ "Room Composite Egress":
   │ the WORKER (our program, every 2 seconds) decides            │ LiveKit opens OUR page
   │ who may publish and what the picture shows                   │ /egress-layout in a hidden
   │                                                              ▼ browser (720x1280) and records it
 Our web app  ◄── Postgres database (astrologers, shifts, settings) ─►  RTMP(S)  ──►  Instagram Live
   ├─ /live/<secret>      astrologer page
   ├─ /ops                ops console (password)
   ├─ /ops/schedule       weekly schedule, recurring slots, CSV import
   └─ /egress-layout      the picture that goes to Instagram
```

The five moving parts, in plain words:

| Part | What it does |
|---|---|
| **Astrologer page** | Shows the countdown, lets them test devices, and publishes their camera the moment the server allows it. |
| **Worker** | A small program that never sleeps. Every 2 seconds it asks: *who should be on air right now?* and makes LiveKit match (lets that person publish, stops everyone else, removes people whose time is over). |
| **LiveKit** | The video server. Takes the astrologer's video and runs the "egress" that sends our picture to Instagram. |
| **Layout page** | The page LiveKit "films". Shows only the on-air astrologer, their name, a "Next: …" strip and the logo. Shows a "we will be right back" video when nobody is on air. |
| **Ops console** | Where you paste the Instagram key, see who is on air, rotate the key, and press emergency buttons. |

**Why can't an astrologer cheat?** Their link gives them a LiveKit pass that *cannot publish*. Only the worker can allow publishing, and only for the person whose shift is running right now. Even a modified browser cannot get past LiveKit's server. As a second safety net the layout page ignores everyone except the person the schedule says is on air.

---

## 2. What you need

| For | You need |
|---|---|
| Trying it on your computer | A Mac / Windows / Linux computer with **Node.js 22 or newer** ([nodejs.org](https://nodejs.org), pick "LTS"). Docker is *optional*. |
| LiveKit | A free **LiveKit Cloud** account ([cloud.livekit.io](https://cloud.livekit.io)). Egress (sending to Instagram) is a feature of the LiveKit Cloud plan — check your plan includes it. |
| A public address for local testing | A free **Cloudflare Tunnel** or **ngrok** (section 4). LiveKit's servers must be able to open our layout page over the internet. |
| Going live for real | A small server (VPS) with a domain name, in India (Mumbai or Bangalore) for lowest delay. 2 CPUs / 4 GB RAM is plenty. |
| Instagram | Access to **Instagram Live Producer** on a desktop computer for the AstroTalk page (this is where Instagram shows the Server URL and Stream key). |

To check Node is installed, open a terminal and type `node -v`. It should print `v22` or higher.

---

## 3. Get your LiveKit keys

1. Go to [cloud.livekit.io](https://cloud.livekit.io) and sign up / log in.
2. Create a **project** (any name, for example `astrotalk-live`).
3. Open the project's **Settings**. You will find three things — copy them somewhere safe:
   - the **project URL**, which looks like `wss://astrotalk-live-abc123.livekit.cloud`
   - an **API key** (looks like `APIxxxxxxxx`)
   - the **API secret** (long text, shown **only once** when you create the key — add a new key from the **Keys** area if you missed it)
4. These go into the `.env` file as `LIVEKIT_URL`, `NEXT_PUBLIC_LIVEKIT_URL` (same address twice), `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`.

> The names of menus in the LiveKit dashboard sometimes change. If something above is not where it says, use the search box in the dashboard or LiveKit's [documentation](https://docs.livekit.io).

**Choosing a region (for low delay).** By default LiveKit Cloud connects each person to the nearest of its servers, so astrologers in India are normally served from an Indian location automatically. LiveKit also lets you *pin* a project to a region — see [LiveKit regions](https://docs.livekit.io/deploy/admin/regions/). Ask LiveKit support or check the dashboard if you want to force India.

**Webhook (recommended, set it after the app is online).** In the LiveKit dashboard open **Settings → Webhooks** (or the Webhooks section) and add the address `https://YOUR-DOMAIN/api/livekit/webhook`. This makes the ops console notice a dropped stream a few seconds sooner. The app also checks by itself every couple of seconds, so it still works without it.

**Later: running your own LiveKit server** on a Mumbai VPS instead of LiveKit Cloud needs *no code changes* — only the three `LIVEKIT_*` values and `NEXT_PUBLIC_LIVEKIT_URL` in `.env`. LiveKit provides a one-time generator that writes the server config, Redis and Egress for you:

```bash
docker pull livekit/generate
docker run --rm -it -v$PWD:/output livekit/generate
```

Follow LiveKit's own guide: [Deploy to a VM](https://docs.livekit.io/transport/self-hosting/vm/). Open the ports it lists (443, 80, 7881, 3478/UDP, 50000-60000/UDP), point your LiveKit domain at the server, and choose to include **Egress** in the generator. Then change the four values in `.env` and restart.

---

## 4. Run it on your own computer (with a tunnel)

> **Why a tunnel?** The Instagram picture is produced by LiveKit's servers, which open our `/egress-layout` page *over the internet*. Your laptop's `localhost` is not on the internet, so we give it a temporary public address.
> You can still try the astrologer pages and the ops console without a tunnel — only "Start stream" needs it.

Open a terminal in the project folder (`AstroBS`) and run the steps below. Use **a separate terminal window for each step marked ▶**.

**Step 1 — install the code libraries (once)**

```bash
npm install
```

**Step 2 — create your settings file (once)**

```bash
cp .env.example .env
```

Open `.env` in any text editor and fill in the LiveKit values from section 3, plus:
- `OPS_PASSWORD` — the ops console password (make it long).
- `SESSION_SECRET` — random text. Create one with: `openssl rand -hex 32`

**Step 3 — ▶ start the database (leave this window open)**

Without Docker (easiest):

```bash
npm run db:up
```

*(With Docker instead: `docker compose -f docker-compose.dev.yml up -d`, and put `postgresql://astro:astro@localhost:5432/astrotalk` into `DATABASE_URL` in `.env`.)*

**Step 4 — create the tables and the sample data (once)**

```bash
npm run db:migrate
npm run db:seed
```

The seed creates **12 sample astrologers** with one-hour shifts that cover all 24 hours for the next 14 days, and prints each astrologer's personal link.

**Step 5 — ▶ start the website**

```bash
npm run dev
```

**Step 6 — ▶ start the worker** (the part that puts people on and off air)

```bash
npm run worker
```

**Step 7 — ▶ start the tunnel and set the public address**

Cloudflare Tunnel (free, no account needed for a quick tunnel). Install it once: Mac `brew install cloudflared`, Windows `winget install Cloudflare.cloudflared`; other systems: [download page](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/). Then:

```bash
cloudflared tunnel --url http://localhost:3000
```

It prints an address like `https://random-words-1234.trycloudflare.com`. *(ngrok works too: `ngrok http 3000`.)*

Put that address into `.env`:

```
NEXT_PUBLIC_APP_URL="https://random-words-1234.trycloudflare.com"
```

then stop (`Ctrl+C`) and restart the website **and** `npm run worker`. The address changes every time you restart the tunnel, so update it each time.

> **Important — when using a tunnel, run the production version of the website, not `npm run dev`.** The development server refuses to serve its scripts to any address other than `localhost`, so LiveKit's hidden browser would load an empty page and the stream would sit on "Starting" forever. Instead of `npm run dev` (Step 5) use:
> ```bash
> npm run build
> npm start
> ```
> (`npm run dev` is fine for everything that does not involve "Start stream".)

**Step 8 — open it**

- Ops console: <http://localhost:3000/ops> (password from `.env`)
- Astrologer link: any of the links printed by the seed step. Camera and mic work on `http://localhost`.
- To see the Instagram layout without LiveKit: <http://localhost:3000/egress-layout?demo=onair> (also `demo=transition`, `demo=connecting`).

**Test without touching the real Instagram page.** In ops console use a free YouTube *unlisted* live as the target:
1. On YouTube, click **Create → Go live** (YouTube Studio), choose **Stream**, set visibility to **Unlisted**.
2. Copy the **Stream URL** (usually `rtmp://a.rtmp.youtube.com/live2`) and **Stream key**.
3. Paste them into the ops console's **Server URL** and **Stream key**, press **Start stream**.
4. YouTube's preview shows the 9:16 picture a few seconds later. (YouTube has its own delay of a few seconds, like Instagram.)

---

## 5. Run the tests

```bash
npm test             # 82 quick tests of the schedule logic, CSV import, slugs, RTMP URLs, key redaction (no database needed)
npm run test:db      # 44 tests against a real database and a pretend LiveKit (needs "npm run db:up" running)
npm run typecheck    # catches typing mistakes
npm run lint         # code style checks
npm run build        # builds the production version
```

`npm run test:db` uses its own throw-away database named `astrotalk_test`; it **never** touches your real data (and refuses to run against any other database).

---

## 6. Put it on a server (production)

You need: a server, a domain name, and about 30 minutes.

**1. Create the server.** Any VPS provider works; choose **Mumbai or Bangalore** (for example AWS Lightsail `ap-south-1`, DigitalOcean `BLR1`). Ubuntu 24.04, 2 vCPU, 4 GB RAM. In the provider's firewall allow ports **22, 80, 443** (and **443/UDP**).

**2. Point your domain at it.** In your DNS settings add an **A record**: `live.yourcompany.com` → the server's IP address. Wait a few minutes.

**3. Install Docker on the server** (log in with SSH, then):

```bash
curl -fsSL https://get.docker.com | sh
```

**4. Copy the project to the server** (for example with `scp`, `rsync` or `git clone`), then in the project folder on the server:

```bash
cp .env.example .env
nano .env        # fill in the values (see below), save with Ctrl+O, quit with Ctrl+X
```

Values to set for production:

| Setting | Value |
|---|---|
| `DOMAIN` | `live.yourcompany.com` |
| `NEXT_PUBLIC_APP_URL` | `https://live.yourcompany.com` |
| `LIVEKIT_URL`, `NEXT_PUBLIC_LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | from section 3 |
| `OPS_PASSWORD` | a long password |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `POSTGRES_PASSWORD` | any long random password |

(You do not need to set `DATABASE_URL` — the compose file sets it.)

**5. Start everything:**

```bash
docker compose up -d --build
```

This starts five services — `caddy` (HTTPS), `web`, `worker`, `db`, and a one-time `migrate` that creates the tables. Caddy gets the HTTPS certificate for your domain automatically; the first visit may take a minute.

**6. Check it:**

```bash
docker compose ps                 # all should be "running" (migrate shows "exited (0)", that is correct)
docker compose logs -f worker     # you should see "[worker] starting"; press Ctrl+C to leave
```

Open `https://live.yourcompany.com/ops`, log in, and check the top bar shows **Schedule worker: Running** and **Video server: Running**.

**7. First-time content.** Open **Schedule** in the ops console and add your real astrologers and slots (or import a CSV). Use **Copy link message** to get a WhatsApp-ready message for each person. *(Do not run the seed script in production unless you want the 12 demo astrologers.)*

**8. Add the LiveKit webhook** (section 3): `https://live.yourcompany.com/api/livekit/webhook`.

### Alternative: deploy on Railway (no server to manage)

Railway builds straight from GitHub and gives you an https address, so you need neither Caddy nor a tunnel. The repo contains two config files for it (`railway.web.json`, `railway.worker.json`).

1. Push this repo to GitHub (private).
2. In Railway: **New Project → Deploy from GitHub repo →** pick the repo. This creates one service; rename it **web**.
3. In the project press **New → Database → Add PostgreSQL**. Keep its name **Postgres** (the variable files refer to it by that name).
4. Press **New → GitHub Repo →** the same repo again; rename it **worker**.
5. For each service open **Settings → Config-as-code → Railway Config File** and enter `railway.web.json` for **web** and `railway.worker.json` for **worker**.
6. For **web**: **Settings → Networking → Generate Domain**.
7. Open each service's **Variables → Raw Editor**, paste the matching list (`NEXT_PUBLIC_APP_URL` is filled from the generated domain by Railway), and deploy:
   - web: `DATABASE_URL`, `LIVEKIT_URL`, `NEXT_PUBLIC_LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `NEXT_PUBLIC_APP_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}`, `OPS_PASSWORD`, `SESSION_SECRET`, `HOSTNAME=0.0.0.0`
   - worker: the same list, but `NEXT_PUBLIC_APP_URL=https://${{web.RAILWAY_PUBLIC_DOMAIN}}` and no `HOSTNAME`
   - `DATABASE_URL` is `${{Postgres.DATABASE_URL}}` in both.
8. The **worker** creates the database tables when it deploys (its "pre-deploy command"). If the web service shows errors on the very first deploy, redeploy **web** once after the worker is up.
9. Add the LiveKit webhook `https://YOUR-RAILWAY-DOMAIN/api/livekit/webhook`.

Notes: keep **one** replica of web; do not redeploy during a live stream (the web service forgets the stream key when it restarts); the uploaded transition video needs a Railway Volume mounted at `/data/uploads` on **web** (also set the variable `RAILWAY_RUN_UID=0`), otherwise it falls back to the built-in video after each deploy.

**Updating to a new version later:**

```bash
docker compose up -d --build
```

**Backing up the database** (do this regularly, copy the file somewhere safe):

```bash
docker compose exec db pg_dump -U astro astrotalk > backup-$(date +%F).sql
```

**Important:** run exactly **one** `web` container. Stream keys are held in that process's memory (that is a security feature) and the rate limits are per process.

---

## 7. Day-to-day guide for the ops team

### Every day
- Keep the ops console open on a computer. Check the two green dots at the top: **Schedule worker** and **Video server**.
- The **Schedule** screen shows the week. Red hatched areas are hours with nobody scheduled. The badge shows **coverage for the next 7 days** — aim for 100%.

### Starting the very first stream (or after a stop)
1. On a desktop computer open **Instagram → your page → Live Producer** and create a new Live. It shows a **Server URL** and a **Stream key**.
2. In the ops console, paste them into **Server URL** and **Stream key** and press **Start stream**.
3. In Live Producer wait until the preview shows the picture, then press **Go Live**.

> Instagram stream keys can only be used **once**, and Instagram ends every Live after **4 hours**.

### Rotating the key (about every 4 hours) — step by step
The ops console warns you: **amber at 3h30**, **red at 3h50** (and, if you allow it, a notification and a short beep).

1. In Instagram Live Producer, create the **next** Live. Copy its **Server URL** and **Stream key**.
2. In the ops console, under **Rotate the stream key**, paste them and press **Start new stream (keep old running)**. The old stream keeps going. The new one shows "New stream (preview, not live yet)".
3. In Live Producer, check the **preview shows video** from the new stream.
4. In the ops console press **Show transition video** — both streams now show the "we will be right back" video.
5. In Instagram: **end the old Live**, then press **Go Live** on the new one.
6. In the ops console press **Confirm switch (stop the old stream)**. The old stream is stopped and the 4-hour timer restarts for the new stream.
7. Press **Hide transition video**.

### Emergency buttons (under **Stage controls**)
| Button | What it does |
|---|---|
| **Show / Hide transition video** | Instantly shows or hides the "we will be right back" video on every running stream. |
| **Mute on-air astrologer** | Silences the person on air for this shift only (viewers hear nothing from them even if they unmute). |
| **Remove astrologer from stage** | Disconnects them and shows the transition video until their slot would have ended. They see a message. |
| **Skip to next astrologer now** | Ends the current shift now and puts the next astrologer on air immediately (it edits the two shifts). |

### If the stream stops unexpectedly
A red alert appears: **The stream stopped unexpectedly**. The system tries **one** automatic restart with the same destination (only if the key is still held in memory). If that does not work: press **Restart stream** if offered; otherwise create a new Live in Instagram and **Start stream** with the new key. Note that Instagram keys are single-use, so a restart usually needs a fresh key.

### Changing the transition video
In the ops console, **Transition video → Upload new video**. Use an MP4 or WebM, portrait **720×1280**, up to 60 MB; it loops. **Use the default** puts the original back.

### Adding or changing astrologers
**Schedule →** *Astrologers*: add, edit, switch off, **Copy link**, **Copy link message** (WhatsApp text), **New link** (the old link stops working immediately — use this if a link was shared by mistake). *Recurring slots* create shifts for the next 14 days automatically. *Import from CSV* has a **Download sample CSV** button.

---

## 8. Troubleshooting

**"The astrologer says the camera or microphone does not work."**
Browsers only allow the camera on a secure address (`https://`, or `localhost`). Tell them to click the camera icon next to the address, choose **Allow**, and reload. Make sure no other app (Zoom, Meet, Teams) is using the camera. The page shows these instructions itself.

**"There is an echo / viewers hear the astrologer twice."**
They are watching the Instagram Live on another device with the sound on while their mic is open. Ask them to **mute that device or wear headphones**. The page shows this tip prominently.

**The ops console says "The schedule worker is not running".**
Nobody will be put on or taken off air automatically. On the server: `docker compose ps` and `docker compose logs --tail 50 worker`. Restart it with `docker compose restart worker`. Locally, check the terminal where you ran `npm run worker`.

**"Start stream" fails, or the stream is "Starting" and then fails (egress not starting).**
1. Is `NEXT_PUBLIC_APP_URL` the **public https address**? Open `<that address>/egress-layout` in a normal browser; you should see "This page is used by the AstroTalk stream". If you cannot, LiveKit cannot either (local testing: is the tunnel running, and did you restart `npm run dev` and `npm run worker` after changing the address?).
2. Is your LiveKit plan allowed to use Egress? Check the LiveKit dashboard.
3. The Server URL must start with `rtmp://` or `rtmps://`.
4. The ops event log (bottom of the console) shows the reason, with the key hidden.

**Instagram is not receiving video.**
- Instagram stream keys are **single-use** and expire. Create a fresh Live in Live Producer and paste the new values.
- Copy the **Server URL** exactly (it normally starts `rtmps://`).
- In the ops console, the stream should say **Live** with LiveKit status `active`. If it says `failed`, read the event log.
- Check the picture: open `/egress-layout?demo=onair` — if that looks right, the layout itself is fine.

**"Start stream" stays on "Starting" and nothing reaches Instagram.**
You are almost certainly running `npm run dev` behind the tunnel (see the note in section 4, Step 7). Stop it, then `npm run build && npm start`, and press **Stop stream** / **Start stream** again.

**The Instagram picture shows "Connecting…" or the transition video while someone is scheduled.**
The astrologer is not connected, or their camera has not started. The ops **Green room** list shows *Not connected*. Ask them to reload their link and press **Turn on camera and microphone**.

**The astrologer page says "This link is not valid".**
The link was mistyped, the astrologer is switched off, or the link was replaced with **New link**. The page deliberately gives no more detail.

**The astrologer page says "This page was opened somewhere else".**
The same link was opened in another tab or device — the newest one wins. Press **Use this tab instead** if this is the one they want.

**The picture is blurry or cropped oddly.**
Instagram shows a portrait (9:16) picture, so a landscape camera is cropped to its middle slice. The astrologer's preview shows the **brighter middle part** that viewers will see — keep your face in it. For a sharper picture, edit `src/components/live/capture.ts` (comments inside explain how to move to 1080p).

**Everything was working and the web app restarted.**
The stream keeps running (LiveKit sends it), but the app forgets the stream key (by design), so an automatic restart is no longer possible. Nothing else is lost.

---

## 9. Delay: where the seconds go

| Step | Typical delay | Notes |
|---|---|---|
| Astrologer → LiveKit | **0.05 – 0.3 s** | WebRTC, nearest LiveKit location. Wired internet helps. |
| LiveKit builds the picture and encodes it (egress) | **~1 – 3 s** | Headless Chrome renders the layout, H.264 encoding, 2-second keyframes. |
| LiveKit → Instagram ingest | **< 1 s** | Over RTMP(S). |
| **Instagram's own delay before viewers see it** | **several seconds (often 5 – 15 s)** | Not under our control. This is the big one. |

Everything we control is built to keep the first two rows small: WebRTC all the way to the server, one video layer (no extra copies), the astrologer's camera is ready *before* they go on air, and the layout page is light on purpose.

---

## 10. Acceptance checklist

Tick these off when you test the system with real LiveKit keys. *(✓ = already covered by automatic tests in this repository; real LiveKit and Instagram steps can only be confirmed by you.)*

- [ ] **1.** Seed data loads; the **Schedule** screen shows 24-hour coverage (`npm run db:seed`, then open **Schedule**; coverage should say 100%).
- [ ] **2.** An astrologer link opens with no login, previews camera and mic, and shows the countdown. *(Page logic ✓; camera needs a real browser.)*
- [ ] **3.** At the shift start the astrologer goes on air automatically with no manual action, and the layout shows only them. *(Permission switching ✓ with a pretend LiveKit; real video needs you.)*
- [ ] **4.** At the shift end they are cut off and the next astrologer goes on air, and the egress output never stops (watch the YouTube/Instagram preview through a hand-off at :00).
- [ ] **5.** A tampered client that tries to publish outside its slot is blocked by the server. *(Token has no publish rights ✓; the worker revokes anyone else ✓. Try it: in the browser console of a waiting astrologer's tab, try publishing — LiveKit refuses.)*
- [ ] **6.** Nobody scheduled → the transition video plays. *(Turn off all shifts for an hour, or press "Show transition video".)*
- [ ] **7.** Ops can start a stream to a test RTMP target (YouTube unlisted, section 4).
- [ ] **8.** Rotate flow: two streams overlap, then the old one stops after **Confirm switch**; the transition toggle works.
- [ ] **9.** The stream-age timer turns amber at 3h30 and red at 3h50 and the banner appears. *(Colour thresholds ✓ by tests.)*
- [ ] **10.** The stream key never appears in logs, the database, network responses after submission, or the screen after submission. *(Code paths ✓ by tests; to check yourself: `docker compose logs | grep -i <part of a test key>` returns nothing, and the key box clears when you press the button.)*
- [ ] **11.** Regenerating an astrologer's link kills the old link. *(✓ by tests.)*

---

## 11. Security notes

- **Personal links are secrets.** 32 random URL-safe characters (192 bits). Never sequential. "New link" replaces it and disconnects them.
- **Ops password**: one shared password (`OPS_PASSWORD`), a signed cookie that JavaScript cannot read, valid 12 hours, login attempts rate-limited. The code is arranged so real user accounts can be added later (`src/lib/auth.ts`).
- **Stream keys** are used once to start the stream and then kept **only in the web server's memory** (for the single automatic retry, up to 2 hours, deleted on stop). They are never in the database, logs, event log, or any response. A redaction function scrubs error messages as a last safety net.
- **Secrets stay on the server.** Only the LiveKit *address* reaches browsers; the API secret, ops password and session secret never do.
- **Rate limits** on token, state, ping, heartbeat, login and ops actions. They are per web process.
- **Headers**: a Content-Security-Policy, `X-Frame-Options`, no-referrer (so links do not leak), `noindex` on every page, and a `Permissions-Policy` that allows camera and microphone **for our own site only**.
- The `web` container is **not** reachable from the internet except through Caddy. Keep it that way: the app trusts the `X-Forwarded-For` header that Caddy writes.
- The Caddy access log replaces `/live/<secret>` with `/live/[redacted]`.

---

## 12. What is where in the code

```
prisma/schema.prisma          the database tables         prisma/seed.ts   sample data
worker/index.ts               the 2-second schedule enforcer
src/lib/schedule/             the schedule maths (pure, unit-tested): on-air, enforcement plan, overlaps, templates, room metadata
src/lib/enforce.ts            carries the plan out against LiveKit
src/lib/egressControl.ts      start / rotate / confirm / stop / noticing a dead stream / the one retry
src/lib/stageControl.ts       transition, mute, remove, skip buttons
src/lib/strings.ts            EVERY sentence users see (translate here)
src/app/live/[slug]           astrologer page          src/components/live/   its logic (capture settings in capture.ts)
src/app/egress-layout         the picture for Instagram src/components/egress/EgressLayout.tsx
src/app/ops, src/components/ops, src/components/schedule   ops console and schedule screens
src/app/api/**                all server endpoints (live/*, ops/*, livekit/webhook, media/transition)
tests/                        unit tests;  tests/integration/  database tests with a pretend LiveKit
Dockerfile.web  Dockerfile.worker  docker-compose.yml  Caddyfile  .env.example
PLAN.md                       the plan this was built from
```

---

## 13. Known limits

- **One web server only** (see section 6).
- Instagram has no API to create Lives, so **key rotation is manual** by design.
- **Ops sign-out only clears your browser's cookie.** A copied cookie stays valid until its 12 hours are up. Change `SESSION_SECRET` and restart to log everyone out at once.
- The web app and the worker can, for up to 2 seconds, disagree right after an ops button press (the worker's next pass fixes it). The Instagram picture is unaffected.
- The astrologer page was built and tested for **desktop Chrome, Edge and Firefox**; phones (Chrome/Safari) are best-effort.
- Drag-to-move on the schedule grid is not built; click a shift to edit it.
- LiveKit does not give the outgoing bitrate/frame-rate of the Instagram stream through its API, so the ops diagnostics show the astrologer-side numbers (reported by their browser) plus LiveKit's egress status. See your LiveKit dashboard for egress details.
- Out of scope (as agreed): comments display, recordings, multiple rooms, payments, astrologer logins, analytics, automatic Instagram key creation, WhatsApp/SMS notifications, advanced failover.
