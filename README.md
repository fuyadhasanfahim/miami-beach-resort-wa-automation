# WhatsApp Auto-Reply Bot (official Meta WhatsApp Cloud API)

A webhook server that replies to a WhatsApp user's **first message** with a
fixed sequence:

1. A preset text message
2. A link
3. A set of images (one by one)
4. A video
5. An audio clip (voice note)

**Each sender is replied to only once, ever.** This runs on the **official
WhatsApp Business Platform (Cloud API)** — no browser, no QR code, no
third-party library. Meta pushes incoming messages to this server over an
HTTPS webhook; the server sends replies back through Meta's Graph API.

It supports **any number of WhatsApp numbers** from one process — Meta tells
you which number a message came in on (`phone_number_id`), so one server and
one webhook URL serve all of them. Numbers can be wired in two ways, and
both can be used together:

- **Static**: set `NUMBER1_*` / `NUMBER2_*` in `.env` (phone_number_id +
  access token you copied from the Meta dashboard yourself).
- **Self-serve**: open `/connect` in a browser and add a number through
  Meta's **Embedded Signup** popup — no manual token copying, works from a
  phone or a desktop browser, and the number goes live immediately with no
  redeploy. See "Embedded Signup" below.

---

## Folder structure

```
wa-automation/
├─ package.json
├─ .env.example          # copy to .env and fill in
├─ Dockerfile / docker-compose.yml / Caddyfile / railway.json
├─ ecosystem.config.js   # pm2 process definition (non-Docker run)
├─ server.js             # entry point: Express app + webhook + /connect + /assets
├─ src/
│  ├─ numbers.js         # reads NUMBER1_*/NUMBER2_* from .env
│  ├─ registry.js        # numbers/registry.json — numbers added via /connect
│  ├─ embeddedSignup.js  # /connect page + Embedded Signup code exchange
│  ├─ instance.js        # wires one number: history, queue, daily cap
│  ├─ webhook.js         # GET verify handshake + POST message intake
│  ├─ graphClient.js     # thin wrapper around Meta's Graph API
│  ├─ replySequence.js   # builds the reply plan, sends with retry/backoff
│  ├─ repliedStore.js    # numbers/<n>/replied.json — who's been contacted
│  ├─ progressStore.js   # numbers/<n>/progress.json — partial-send resume
│  ├─ dailyCap.js        # numbers/<n>/daily.json — daily new-contact cap
│  ├─ dispatcher.js      # concurrency pool (N senders in parallel)
│  ├─ settings.js        # defaults + per-number overrides
│  ├─ logger.js
│  ├─ rand.js
│  └─ withTimeout.js
├─ public/
│  └─ connect.html       # the /connect signup page (Meta JS SDK)
├─ assets/               # shared media, served publicly at /assets/*
│  ├─ message.txt
│  ├─ link.txt
│  ├─ images/1.jpeg … 8.jpeg
│  ├─ video.mp4
│  └─ voice.ogg
└─ numbers/
   ├─ registry.json      # numbers added via /connect (auto-created)
   ├─ number1/           # replied.json, progress.json, daily.json (auto-created)
   └─ number2/
```

Media is sent to WhatsApp as a public `https://.../assets/...` link (served
by this same server) rather than uploaded to Meta ahead of time — no
media-id bookkeeping, and both numbers reuse the same files.

---

## Requirements

- Node.js 18+ (uses the built-in `fetch`).
- A Meta **WhatsApp Business Platform** app with:
  - A verified WhatsApp Business Account (WABA).
  - One or two phone numbers added and verified.
  - A **permanent** access token (a System User token from Meta Business
    Suite — the temporary 24h tokens from the quick-start screen are not
    enough for a long-running server).
- A domain you control, with a subdomain pointed at this server, over HTTPS
  (Meta requires a valid TLS certificate on the webhook URL — see **DNS &
  webhook setup** below).

---

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env` — see the table below. **Start with `NUMBER1_*` only** and leave
`NUMBER2_*` blank; add the second number once the first is confirmed
working.

### Environment variables

| Variable | Meaning |
|---|---|
| `PORT` | Local port the server listens on (default `3000`). |
| `PUBLIC_BASE_URL` | Public https URL this server is reachable at, no trailing slash (e.g. `https://wa.yourdomain.com`). Used both for the webhook and for the asset links Meta fetches media from. |
| `VERIFY_TOKEN` | Any string you choose. Entered again in the Meta App dashboard when you configure the webhook — Meta echoes it back on setup to prove you control the endpoint. |
| `APP_SECRET` | From Meta App dashboard → App settings → Basic → App secret. Verifies each incoming webhook call really came from Meta. Required before going live. |
| `GRAPH_API_VERSION` | Graph API version to call (default `v21.0`). |
| `NUMBER1_LABEL` / `NUMBER2_LABEL` | Label shown in logs. |
| `NUMBER1_PHONE_NUMBER_ID` / `NUMBER2_PHONE_NUMBER_ID` | From Meta App dashboard → WhatsApp → API Setup, "Phone number ID" (not the phone number itself). |
| `NUMBER1_ACCESS_TOKEN` / `NUMBER2_ACCESS_TOKEN` | The permanent System User access token, scoped to `whatsapp_business_messaging`. |
| `NUMBER1_DAILY_CAP` / `NUMBER2_DAILY_CAP` | *(optional)* Max new senders replied to per day, per number. Unset/`0` = unlimited. |
| `NUMBER1_CONCURRENCY` / `NUMBER2_CONCURRENCY` | *(optional)* Senders served in parallel per number (default `3`). |
| `NUMBER1_SEND_DELAY_MS` / `NUMBER2_SEND_DELAY_MS` | *(optional)* Base pacing between items in one sender's sequence (default `1000`). |
| `META_APP_ID` / `META_APP_SECRET` | Only needed for the `/connect` self-serve signup page. From Meta App dashboard → App settings → Basic. `META_APP_SECRET` is the same value as `APP_SECRET` above. |
| `META_CONFIG_ID` | Only needed for `/connect`. The Embedded Signup Configuration ID — see "Embedded Signup" below for how to create one. |
| `CONNECT_ADMIN_TOKEN` | Only needed for `/connect`. A password you make up; whoever opens the page must paste it in before it will onboard a number. |

---

## Deploy on Railway (recommended)

Railway builds straight from the `Dockerfile` (via `railway.json`) — no
Caddy needed here, Railway terminates HTTPS for you on both its own
`*.up.railway.app` domain and any custom domain you attach.

1. **New Project → Deploy from GitHub repo** (push this repo to GitHub
   first if it isn't already), or `railway up` from the CLI.
2. **Add a Volume**, mounted at `/app/numbers` — this is where
   `replied.json` / `progress.json` / `daily.json` live. Without a volume,
   Railway's container filesystem is wiped on every redeploy and the "only
   reply once" history would be lost.
3. **Variables tab** → paste in everything from `.env.example` with real
   values. For `PUBLIC_BASE_URL`, use the `*.up.railway.app` URL Railway
   assigns on first deploy (Settings → Networking → Public Networking) —
   you can switch this to the custom domain later, it's just a value swap
   + redeploy.
4. Once it's deployed, `https://<your-app>.up.railway.app/health` should
   return `{"ok":true,...}` — **this already gives you a working HTTPS
   callback URL** to use for both the messages webhook and Embedded Signup
   (see below) without waiting on DNS at all.
5. **Custom domain** (optional, do this once the above is confirmed
   working): Settings → Networking → Custom Domain → enter
   `wa.miamibeachresort.com`. Railway shows a CNAME target
   (`something.up.railway.app` — unique per service, shown only after you
   add the domain). At your DNS provider for `miamibeachresort.com`, add:

   | Type | Host | Value |
   |---|---|---|
   | CNAME | `wa` | *(exactly what Railway showed you in step 5)* |

   Once it resolves, update `PUBLIC_BASE_URL` to
   `https://wa.miamibeachresort.com` and redeploy.

   Railway doesn't sell/register domains itself — `miamibeachresort.com`
   has to already be registered somewhere (whoever manages its DNS today);
   Railway only gives you the free `*.up.railway.app` one automatically,
   plus lets you attach a domain you already own via the CNAME above.

### Webhook setup (Meta App dashboard)

1. WhatsApp → Configuration → Webhook → **Edit**.
2. Callback URL: `PUBLIC_BASE_URL` + `/webhook` (the Railway URL from step
   4 above, or the custom domain once it's live).
3. Verify token: the same value you put in `.env` as `VERIFY_TOKEN`.
4. Click **Verify and save** — Meta calls the URL once; the server logs
   `Webhook verified by Meta.` on success.
5. Under **Webhook fields**, subscribe to `messages` and `account_update`
   (the second one is only used as a debug/fallback log line for Embedded
   Signup completions — see below — but costs nothing to subscribe to).
6. This one webhook URL is shared by every number, whether it was added via
   `.env` or through `/connect` — nothing to repeat per number.

---

## Embedded Signup (`/connect` — self-serve number onboarding)

Lets you (or the client) add a WhatsApp number through Meta's own popup —
paste an admin token, click connect, log into the WhatsApp Business
account, done. No copying phone_number_id / access token by hand, works
from a phone or a laptop, and the number is live the moment it finishes —
no redeploy.

### One-time Meta App dashboard setup

You said this isn't done yet — here's the exact path:

1. In your Meta App, **Add Product → Facebook Login for Business** (search
   "Facebook Login for Business" in the product picker if it's not shown on
   the main page).
2. Facebook Login for Business → **Configurations** → **Create configuration**.
3. Choose **Business login for WhatsApp Embedded Signup** as the use case
   (naming varies slightly by dashboard version — pick the WhatsApp-specific
   embedded signup option, not generic login).
4. Select the permissions it asks for (`whatsapp_business_management`,
   `whatsapp_business_messaging` — the dashboard usually pre-selects the
   right set for this use case).
5. Save — you'll get a **Configuration ID** (a numeric string). That's
   `META_CONFIG_ID` in `.env`.
6. `META_APP_ID` / `META_APP_SECRET` are the same App ID / App secret you
   already have from App settings → Basic (same value as `APP_SECRET`).
7. If the app is still in **Development mode**, only people added as
   Admins/Developers/Testers on the app (in Meta App dashboard → App roles)
   can complete Embedded Signup. Meta App Review is required before
   *other* businesses can use it — not needed if it's only ever going to
   onboard Miami Beach Resort's own numbers.

### Using it

1. Open `PUBLIC_BASE_URL + /connect` in a browser (phone or desktop both
   work).
2. Paste in `CONNECT_ADMIN_TOKEN`.
3. Click **Connect WhatsApp Number** — a Meta popup walks through picking
   the WhatsApp Business Account and phone number.
4. On success the page shows the connected `phoneNumberId` — that number
   starts receiving/replying immediately, no restart needed. It's saved to
   `numbers/registry.json` (persisted the same way as everything else under
   `numbers/`, so it survives restarts/redeploys as long as that directory
   — or the Railway Volume — is in place).

Numbers added this way and numbers set via `NUMBER1_*`/`NUMBER2_*` in
`.env` work side by side; there's no limit of two once you're on
Embedded Signup.

---

## Alternative: self-hosted with Docker (e.g. on a Windows machine)

Two containers: the app, and **Caddy** as reverse proxy — Caddy gets and
renews the Let's Encrypt HTTPS certificate automatically, no nginx/certbot
setup needed. Only relevant if you're *not* using Railway above.

```bash
cp .env.example .env      # fill in the real values first
docker compose up -d --build
docker compose logs -f app
```

Reply history (`numbers/`) is bind-mounted from the host, so it survives
`docker compose down` / rebuilds. Both containers restart automatically
(`restart: unless-stopped`) if the machine reboots or Docker restarts them.

**Requirements for Caddy's automatic HTTPS to work:**
- Ports **80** and **443** on the host must reach the internet (see the
  Windows section below for port forwarding).
- The DNS record for `wa.miamibeachresort.com` must already resolve to this
  machine before you start the containers — Caddy requests the certificate
  on first startup and will retry if it fails, but it needs the DNS in place.

### Running this on a Windows machine

Since this will run on a Windows box rather than a cloud server, a few
things need to be set up **once** and then left alone:

1. **Install Docker Desktop**, and in *Settings → General* enable
   **"Start Docker Desktop when you sign in"**, plus
   *Settings → General* → keep WSL2 backend on (default). Log the machine
   in automatically after a reboot (no one has to manually sign in) —
   otherwise Docker Desktop won't start after a power cut / Windows Update
   reboot until someone logs in.
2. **Router port forwarding**: forward external ports `80` and `443` to
   this Windows machine's local IP, both to the same ports. Give the
   machine a **static local IP reservation** in the router (by MAC address)
   so the forwarding rule doesn't break when it gets a new local IP.
3. **Windows Firewall**: allow inbound TCP 80 and 443 (Docker Desktop
   usually opens these automatically when the containers publish them, but
   confirm under *Windows Defender Firewall → Allowed apps*).
4. **Dynamic IP?** Most non-business ISP connections change your public IP
   occasionally. If yours does, run a Dynamic DNS client (e.g. the free tier
   of [duckdns.org](https://www.duckdns.org) or your domain registrar's own
   DDNS support if it has one) on the same machine, and point the
   `wa.miamibeachresort.com` DNS record at that instead of a raw IP. Ask
   your ISP whether the connection has a static IP — if it does, skip DDNS
   and use a plain A record.
5. **Auto-start the containers on boot**: with `restart: unless-stopped`
   already set in `docker-compose.yml`, Docker restarts them automatically
   once Docker Desktop itself is running — so step 1 (Docker Desktop
   starting on sign-in) is what actually keeps this alive after a reboot.
6. **Windows Update**: set Active Hours (*Settings → Windows Update →
   Advanced options*) to a range that covers business hours, so automatic
   update reboots land overnight rather than mid-shift.

⚠️ **Worth flagging honestly:** running a guest-facing messaging bot on a
general-purpose office/reception Windows PC is less reliable than a small
cloud VPS (~$5/mo) — a manual shutdown, sleep mode, unplugged power, or an
update reboot at the wrong time takes the webhook down until someone
notices and the machine comes back online. If that machine is dedicated to
running just this (never slept, never manually rebooted without checking),
it's fine; if it's someone's everyday desktop, a small VPS removes that
whole risk class for very little cost. Your call — the Docker setup above
works identically on either.

---

## Run without Docker (pm2)

```bash
npm install
npm start     # registers with pm2, keeps it alive across crashes
npm run logs
npm run status
npm run stop
```

For local debugging without pm2: `npm run dev` (needs a tunnel like `ngrok`
if you want Meta to actually reach it while developing).

---

## Reliability (kept from the previous version)

- **Per-item retry with backoff** — each send is retried up to
  `sendRetryAttempts` times; Graph API errors that will never succeed (bad
  number, outside the 24h reply window, permanently blocked) are **not**
  retried — the sender is marked replied so the sequence isn't re-attempted.
- **Partial-send resume** — progress is written to `progress.json` after
  each item; a half-finished sequence resumes from the next unsent item.
  `replied.json` is only written once the whole sequence completes.
- **Randomised pacing** — a random gap between items, an extra pause before
  video/audio, and a short random delay before a sequence starts, so a burst
  doesn't look mechanical.
- **Daily new-contact cap** — optional per-number ceiling on first-time
  replies per calendar day.
- **Concurrency pool** — several senders served in parallel, each job
  time-boxed so a stuck send can't wedge the whole queue.

---

## Migrating from the old (whatsapp-web.js) reply list

⚠️ The previous system's `replied.json` stored WhatsApp's internal
`@lid` identifiers (e.g. `85092143775992@lid`) — these are **not** real
phone numbers and cannot be converted to one. The Cloud API's webhook
identifies senders by their actual phone number (`wa_id`, e.g.
`8801XXXXXXXXX`), so the old list can't be carried over automatically.

If you can export the **actual phone numbers** of people already contacted
(e.g. from the WhatsApp Business app's chat list, or an existing CRM/export),
send that list and it can be pre-loaded into `numbers/number1/replied.json`
/ `numbers/number2/replied.json` (a plain JSON array of phone numbers, no
`+`, no spaces — e.g. `["8801700000000", "8801800000000"]`) before the bot
goes live, so those people are not messaged again.

---

## Notes & limits

- This uses the **official WhatsApp Business Platform (Cloud API)** — no
  ToS risk from browser automation, but Meta's own rules apply: free-form
  replies (text/image/video/audio, as this bot sends) are only allowed
  within the 24-hour customer service window after the user's last message,
  which is exactly the "reply once, right after they write in" flow here.
- Media messages are sent as public links Meta fetches from `/assets/*` on
  this server — keep the server reachable and those files in place.
- Throughput vs. safety: `NUMBERx_CONCURRENCY` and `NUMBERx_SEND_DELAY_MS`
  are the two knobs, same trade-off as before — higher concurrency / lower
  delay clears a burst faster but pushes the account's messaging tier
  harder. Start conservative and watch the logs for retries/failures.

---

## Author

**Fuyad Hasan Fahim**

- Website: https://fuyadhasanfahim.com
- GitHub: https://github.com/fuyadhasanfahim
- LinkedIn: https://www.linkedin.com/in/fuyadhasanfahim0/
- X: https://x.com/codewithfuyad
- Instagram: https://www.instagram.com/codewithfuyad/
- Facebook: https://www.facebook.com/fuyad.code
