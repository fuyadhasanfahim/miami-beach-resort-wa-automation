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
later, the bot ignores them. This is saved to a local `replied.json` file per
instance, so it survives restarts. No database, no network — just a file.

Only **1-on-1 personal chats** trigger a reply (both `@c.us` and the newer
`@lid` sender ids). Groups, channels/newsletters and status updates are ignored.

You can run it for **two WhatsApp numbers** independently — each as its own
process with its own session folder, its own config, and its own
`replied.json`.

### How incoming messages are handled

1. A first-time sender is put on an in-memory queue.
2. A small worker pool processes up to `concurrency` senders **at the same time**
   (default 3). Each sender still gets their own items in order
   (text → link → images → video → audio); the pool just means 3 different
   people can be served in parallel instead of one-at-a-time.
3. Each individual send is retried up to `send_retry_attempts` times
   (2s → 4s → 8s backoff).
4. When a sender's whole sequence succeeds, they're written to `replied.json`.
5. If a sequence fails outright (after retries), the sender is **not** marked —
   they'll get the sequence on their next message (they may see a repeat of the
   first few items).

The queue is in memory. If the process is killed while people are still waiting,
those waiting senders are dropped — but since they were never marked replied,
they get served when they message again.

---

## Folder structure

```
wa-automation/
├─ package.json
├─ setup.sh                   # one-command setup (Linux / macOS / Git Bash / WSL)
├─ setup.ps1                  # one-command setup (native Windows PowerShell)
├─ run.js                     # entry point: node run.js <instance>
├─ start-number1.sh           # start the bot for WhatsApp number 1
├─ start-number2.sh           # start the bot for WhatsApp number 2
├─ stop-number1.sh            # stop number 1 + clear orphan Chromium / locks
├─ stop-number2.sh            # stop number 2 + clear orphan Chromium / locks
├─ scripts/
│  ├─ load-node.sh            # adds vendor/node to PATH when present
│  └─ cleanup.sh              # kill + unlock one instance (used by start/stop)
├─ vendor/node/               # local Node.js, only if setup.sh had to install it
├─ src/
│  ├─ bot.js                  # client setup + event handlers (shared)
│  ├─ config.js               # loads an instance's config.json
│  ├─ repliedStore.js         # local replied.json — who has been contacted
│  ├─ dispatcher.js           # concurrency pool (N senders in parallel)
│  ├─ replySequence.js        # sends text -> link -> images -> video -> audio (with retry)
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
   │  ├─ replied.json         # auto-created; who has already been replied to
   │  └─ .wwebjs_auth/        # session (auto-created after first QR scan)
   └─ number2/
      ├─ config.json
      ├─ replied.json
      └─ .wwebjs_auth/
```

---

## Requirements

- A machine that can run headless Chromium. whatsapp-web.js downloads its own
  Chromium via Puppeteer during setup.
- Node.js 18+ — **or nothing**: the setup script installs a local copy if you
  don't have it.

(No database required.)

---

## One-command setup

Run the setup script for your OS:

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
3. Runs `npm install` (this also installs **pm2**, the process manager the
   start scripts use, into `node_modules/`).
4. Downloads the Chromium build WhatsApp Web needs.
5. Tries a global `pm2` install too (optional; ignored if it needs admin).
6. Makes the start scripts executable.

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
| `concurrency`     | How many different senders to serve in parallel (default `3`). Raise to 4–5 for faster clearing of a burst; if you start seeing send errors, lower it. |
| `send_delay_ms`   | Pause between each send inside one sequence (default `1000`). Lower (e.g. `700`) to make each sequence faster. |
| `send_retry_attempts` | Times to try each individual send before failing it (default `3`). |
| `send_retry_base_ms`  | First retry backoff; doubles each time — 2s, 4s, 8s (default `2000`). |
| `executable_path` | *(optional)* Path to a specific Chrome/Chromium binary.               |

Both numbers currently use the **same shared content** from `assets/`. To give a
number its own content, point its `assets_dir` at a different folder, or set the
`images` / `video_path` / `audio_path` to different files.

---

## Run

Every start goes through **pm2**. The start script (re)registers the instance
with pm2, starts it, saves the pm2 process list, then tails the log. pm2 keeps
the bot alive: it restarts it on a crash and on the watchdog's unhealthy exit
(5s back-off, up to 50 restarts inside the stability window). Pressing `Ctrl+C`
only closes the log view — the bot keeps running in the background.

| | Linux / macOS / Git Bash / WSL | Windows PowerShell |
|--|------------------------------|-------------------|
| Start number 1 | `./start-number1.sh` | `.\start-number1.ps1` |
| Start number 2 | `./start-number2.sh` | `.\start-number2.ps1` |
| Stop number 1 | `./stop-number1.sh` | `.\stop-number1.ps1` |
| Stop number 2 | `./stop-number2.sh` | `.\stop-number2.ps1` |
| All instances, live logs | `npm run logs` | `npm run logs` |
| Process status | `npm run status` | `npm run status` |

On the **first** start a QR code appears in the log tail. On the phone for that
number, open **WhatsApp → Settings → Linked devices → Link a device** and scan
it. After the first scan the session is saved in that instance's
`.wwebjs_auth/` folder — later starts connect automatically without a QR.

To also bring the pm2 apps back after an OS reboot, run `pm2 startup` once
(follow the printed instruction) and then `pm2 save`. On Windows use
`pm2-installer` or the `pm2-startup` package for the same effect.

For a foreground run without pm2 (debugging only): `npm run run:number1`.

When you see `Client is ready. ... Waiting for messages...`, message the bot
number from another phone. The first message gets the full sequence; anything
after that is ignored.

---

## Stopping

`Ctrl+C` in the start terminal only detaches the log view; pm2 keeps the bot
running. To actually stop it, use the stop script — it removes the app from pm2
and clears any leftover Chromium / lock files. **Do not `kill -9`.**

```bash
./stop-number1.sh      # Windows PowerShell: .\stop-number1.ps1
./stop-number2.sh      # Windows PowerShell: .\stop-number2.ps1
```

The start scripts also run that cleanup before (re)starting, so a plain re-run
is always safe.

---

## Resetting

- **Let everyone get the sequence again (one number):** stop the bot, delete
  `instances/number1/replied.json`, start again.
- **Re-send to one person:** stop the bot, open `instances/number1/replied.json`
  (a JSON array of ids), remove that person's id, save, start again. If that id
  also appears in `instances/number1/progress.json` (a partial send), remove it
  there too.
- **Force a fresh QR / re-pair a number:** stop the bot, delete that instance's
  `.wwebjs_auth/` folder, start again, scan the new QR.
- **Log says `Disconnected (LOGOUT)` and the bot exits:** WhatsApp un-paired that
  linked device. On the phone open **WhatsApp → Linked devices** (max 4 devices —
  remove old ones), then delete `instances/<name>/.wwebjs_auth/` and start again
  to scan a fresh QR. Frequent re-scanning or heavy sending makes WhatsApp do
  this, so keep the process running once it's up rather than restarting a lot.
- **"The browser is already running for ...":** a previous run's Chromium didn't
  exit. Run `./stop-number1.sh` (it kills the orphan and clears the lock), then
  start again.

---

## Logs

Every line is timestamped and tagged with the instance name. You'll see log
lines for: QR shown, authenticated, ready, watchdog status, each inbound message
(`Inbound (...) from=... type=... body="..."`), why a message was skipped,
`Queued ... (active X/N, waiting Y)`, `Processing ...` (with `resuming N/M` on a
partial retry), each item sent (`sent <item> (N/M)`), retries, `Done ...`,
failures, disconnect, and `Exiting (...)`.

The shell scripts and the pm2 config write this stream to
`instances/<name>/run.log` as well as the terminal.

---

## Reliability

Long unattended runs are protected by four mechanisms:

- **Per-step timeouts.** Every `sendMessage`, chat lookup and full reply
  sequence is time-boxed (`action_timeout_ms`, `sequence_timeout_ms`,
  `chat_resolve_timeout_ms`). A stalled WhatsApp Web page can no longer hang a
  send forever.
- **Concurrency-slot recovery.** The dispatcher time-boxes each job
  (`job_timeout_ms`), so a wedged send always releases its slot and the queue
  keeps draining.
- **Health watchdog.** Every `health_check_interval_ms` the bot calls
  `getState()`; after `health_check_max_failures` consecutive bad results (or a
  job stuck past `stuck_job_ms`) it exits non-zero so the supervisor / pm2 can
  restart it clean. Re-initialising a broken client in place is not attempted.
- **Partial-send resume.** Progress is written to
  `instances/<name>/progress.json` after each item. If a sequence fails halfway,
  the sender's next message resumes from the next unsent item instead of
  repeating the whole batch. `replied.json` is only written after the full
  sequence completes.

All timeouts and thresholds are optional keys in `instances/<name>/config.json`;
the defaults are tuned for the 8-image + video + audio sequence.

---

## Notes & limits

- This uses **whatsapp-web.js**, an unofficial library that automates WhatsApp
  Web. It is not an official WhatsApp API. Aggressive mass-messaging can get a
  number flagged.
- The machine must stay running for the bot to work. The start scripts run it
  under [`pm2`](https://pm2.keymetrics.io/) using the bundled
  `ecosystem.config.js`, which restarts the bot automatically when it crashes or
  the watchdog exits it. `npm run status` / `npm run logs` inspect it; run
  `pm2 startup` + `pm2 save` once to also survive an OS reboot.
- Throughput vs. safety: `concurrency` and `send_delay_ms` are the two knobs.
  Higher concurrency / lower delay clears a burst faster but pushes WhatsApp Web
  and the single browser page harder. Start at `concurrency: 3`,
  `send_delay_ms: 1000` and adjust while watching the logs for send errors.
- Duplicate protection: repeat messages from the same person (or the `message` +
  `message_create` events firing together) are ignored while that sender is
  queued / in progress, and afterwards via `replied.json`. A half-finished
  sequence resumes from `progress.json` rather than restarting.

---

## Author

**Fuyad Hasan Fahim**

- Website: https://fuyadhasanfahim.com
- GitHub: https://github.com/fuyadhasanfahim
- LinkedIn: https://www.linkedin.com/in/fuyadhasanfahim0/
- X: https://x.com/codewithfuyad
- Instagram: https://www.instagram.com/codewithfuyad/
- Facebook: https://www.facebook.com/fuyad.code
