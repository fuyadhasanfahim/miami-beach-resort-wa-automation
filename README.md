# WhatsApp Auto-Reply Bot (whatsapp-web.js)

Locally-hosted WhatsApp auto-reply bot. Connects as a **Linked Device** by
scanning a QR code. When someone messages you for the **first time**, the bot
replies once with a fixed sequence:

1. A preset text message
2. A link
3. A set of images (one by one)
4. A video
5. An audio clip (sent as a voice note)

**Each sender is replied to only once, ever.** If the same person messages again
later, the bot ignores them. This is stored in MongoDB, so it survives restarts.

Only **1-on-1 personal chats** trigger a reply (both `@c.us` and the newer
`@lid` sender ids). Groups, channels/newsletters and status updates are ignored.

You can run it for **two WhatsApp numbers** independently — each as its own
process with its own session folder and its own config. Each number keeps a
separate "already replied" list.

### How incoming messages are handled

1. A first-time sender is added to a **MongoDB job queue** (`pending_jobs`).
2. A single worker drains the queue **one sender at a time** (never in parallel),
   so 2 or 200 people messaging at once are served in order without hammering
   WhatsApp Web or the browser.
3. For each sender the worker sends the full sequence, retrying each individual
   send up to 3 times (2s → 4s → 8s backoff), and remembering how far it got so
   a retry resumes instead of re-sending.
4. On success the sender moves to `replied_senders` and the job is removed.
5. After each sender the worker waits `inter_contact_gap_ms` (default 3s) before
   the next one.

Because the queue lives in MongoDB, a crash/restart resumes cleanly: jobs left
mid-flight are picked up again (a sender may see a couple of repeated messages in
that rare case, but always gets the full sequence).

---

## Folder structure

```
wa-automation/
├─ package.json
├─ .env                       # DATABASE_URL (MongoDB connection string)
├─ setup.sh                   # one-command setup (Linux / macOS / Git Bash / WSL)
├─ setup.ps1                  # one-command setup (native Windows PowerShell)
├─ run.js                     # entry point: node run.js <instance>
├─ start-number1.sh           # start the bot for WhatsApp number 1
├─ start-number2.sh           # start the bot for WhatsApp number 2
├─ scripts/
│  └─ load-node.sh            # adds vendor/node to PATH when present
├─ vendor/node/               # local Node.js, only if setup.sh had to install it
├─ src/
│  ├─ bot.js                  # client setup + event handlers (shared)
│  ├─ config.js               # loads an instance's config.json
│  ├─ store.js                # MongoDB: replied_senders + pending_jobs queue
│  ├─ worker.js               # drains the queue, one sender at a time
│  ├─ replySequence.js        # sends text -> link -> images -> video -> audio (with retry/resume)
│  └─ logger.js               # timestamped, instance-tagged logging
├─ assets/                    # shared media, used by both numbers
│  ├─ message.txt             # the preset reply text
│  ├─ link.txt                # the link to send
│  ├─ images/
│  │  └─ 1.jpeg … 8.jpeg
│  ├─ video.mp4
│  └─ voice.ogg
└─ instances/
   ├─ number1/
   │  ├─ config.json          # config for WhatsApp number 1
   │  └─ .wwebjs_auth/        # session (auto-created after first QR scan)
   └─ number2/
      ├─ config.json
      └─ .wwebjs_auth/
```

---

## Requirements

- A machine that can run headless Chromium. whatsapp-web.js downloads its own
  Chromium via Puppeteer during setup.
- A **MongoDB** database. The connection string goes in `.env` as `DATABASE_URL`.
- Node.js 18+ — **or nothing**: the setup script installs a local copy if you
  don't have it.

---

## One-command setup

Create `.env` in the project root first:

```
DATABASE_URL="mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/wa-automation?appName=Cluster0"
```

Then run the setup script for your OS:

| OS | Command |
|----|---------|
| Linux | `./setup.sh` |
| macOS | `./setup.sh` |
| Windows (Git Bash or WSL) | `./setup.sh` |
| Windows (PowerShell) | `powershell -ExecutionPolicy Bypass -File setup.ps1` |

The setup script:

1. Detects your OS and CPU architecture.
2. If Node.js 18+ is missing, downloads a local copy into `vendor/node/`
   (no admin rights, nothing installed system-wide).
3. Runs `npm install`.
4. Downloads the Chromium build WhatsApp Web needs.
5. Checks that `.env` has `DATABASE_URL`.
6. Makes the start scripts executable.

The bot uses two MongoDB collections, created automatically:
`replied_senders` (who has already received the sequence) and `pending_jobs`
(the live queue).

If you already have Node.js and just want dependencies: `npm install`.

---

## Configure

Edit `instances/number1/config.json` (and `instances/number2/config.json`):

| Field             | Meaning                                                                 |
|-------------------|------------------------------------------------------------------------|
| `instance_name`   | Label shown in the logs, so you know which number a log line is for.  |
| `assets_dir`      | Where media/text files live, relative to the config file. Default points to the shared `assets/` folder. |
| `reply_text_file` | Text file (inside `assets_dir`) whose contents are sent as the message. |
| `reply_text`      | *(alternative)* Put the text directly here instead of using a file.   |
| `reply_link_file` | Text file whose contents are sent as the link.                        |
| `reply_link`      | *(alternative)* Put the link directly here.                           |
| `images`          | Ordered list of image paths to send.                                  |
| `video_path`      | Video file to send.                                                   |
| `audio_path`      | Audio file — sent as a voice note.                                    |
| `send_delay_ms`   | Pause between each send inside one sequence (default `1000`).          |
| `inter_contact_gap_ms` | Pause after finishing one sender before starting the next (default `3000`). |
| `send_retry_attempts` | Times to try each individual send before failing it (default `3`). |
| `send_retry_base_ms`  | First retry backoff; doubles each time — 2s, 4s, 8s (default `2000`). |
| `max_job_attempts`    | Times to re-attempt a whole sequence across retries before giving up and marking the sender replied (default `3`). |
| `executable_path` | *(optional)* Path to a specific Chrome/Chromium binary.               |

Both numbers currently use the **same shared content** from `assets/`. To give a
number its own content, point its `assets_dir` at a different folder, or set the
`images` / `video_path` / `audio_path` to different files.

---

## Run

Open **two separate terminals** — one per number.

**Terminal 1 — WhatsApp number 1:**
```bash
./start-number1.sh
```
A QR code appears. On the phone with **number 1**, open
**WhatsApp → Settings → Linked devices → Link a device** and scan it.

**Terminal 2 — WhatsApp number 2:**
```bash
./start-number2.sh
```
Scan this QR with the phone holding **number 2**.

(You can also run `npm run start:number1` / `npm run start:number2`, or
`node run.js number1` directly — the shell scripts just do that for you and run
`npm install` first if needed.)

After the first scan, the session is saved in that instance's `.wwebjs_auth/`
folder — subsequent starts connect automatically without a QR.

When you see `Client is ready. Waiting for incoming messages...`, message the bot
number from another phone. The first message gets the full sequence; anything
after that is ignored.

---

## Resetting

- **Let everyone get the sequence again (one number):** remove that number's
  entries from MongoDB:
  ```
  db.replied_senders.deleteMany({ instance: "number1" })
  db.pending_jobs.deleteMany({ instance: "number1" })
  ```
- **Re-send to one person:** delete just their rows:
  ```
  db.replied_senders.deleteMany({ instance: "number1", sender: "<id>@c.us" })
  db.pending_jobs.deleteMany({ instance: "number1", sender: "<id>@c.us" })
  ```
- **Force a fresh QR / log out a number:** delete that instance's
  `.wwebjs_auth/` folder, then restart.
- **"The browser is already running for ...":** a previous run's Chromium didn't
  exit. Kill leftover `chrome`/`node` processes for this project (or delete
  `instances/<name>/.wwebjs_auth/session-<name>/SingletonLock`), then restart.

---

## Logs

Every line is timestamped and tagged with the instance name. You'll see log
lines for: database connected, QR shown, authenticated, ready, each inbound
message (`Inbound (...) from=... type=... body="..."`), why a message was skipped,
`Queued ...`, `Queue: processing ...`, each item sent, retries, `Queue: finished`,
errors, disconnect, and reconnect attempts.

---

## Notes & limits

- This uses **whatsapp-web.js**, an unofficial library that automates WhatsApp
  Web. It is not an official WhatsApp API. Aggressive mass-messaging can get a
  number flagged.
- The machine must stay running with the process alive for the bot to work. To
  keep it running in the background, use a process manager such as
  [`pm2`](https://pm2.keymetrics.io/):
  ```bash
  npm install -g pm2
  pm2 start run.js --name wa-number1 -- number1
  pm2 start run.js --name wa-number2 -- number2
  pm2 save
  ```
- Concurrency: many people messaging at once is fine — everyone is queued and
  served one at a time. The trade-off is latency: with N people waiting, the
  last one waits roughly `N × (sequence time + inter_contact_gap_ms)`.
- Duplicate protection: repeat messages from the same person (or the `message` +
  `message_create` events firing together) can't double-queue — `pending_jobs`
  and `replied_senders` are both keyed on `instance + sender`.

---

## Author

**Fuyad Hasan Fahim**

- Website: https://fuyadhasanfahim.com
- GitHub: https://github.com/fuyadhasanfahim
- LinkedIn: https://www.linkedin.com/in/fuyadhasanfahim0/
- X: https://x.com/codewithfuyad
- Instagram: https://www.instagram.com/codewithfuyad/
- Facebook: https://www.facebook.com/fuyad.code
