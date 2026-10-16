# wa-link-sender

Paste a **Facebook / TikTok / YouTube** post link into a web page and send it to WhatsApp groups that
your own WhatsApp number is **already a member of**. Runs 24/7 in Docker, on Windows (Docker Desktop)
or a Linux server.

- Live progress, history with **Retry failed groups**, saved group lists and message templates
- Safety rules enforced on the server: random pause between groups (default 15–40 s), daily limit,
  sending hours, duplicate-link warning, one message at a time
- Pending sends are stored in SQLite and **survive restarts**
- The WhatsApp login is stored in a Docker volume, so **restarts and rebuilds don't need a new QR scan**

It uses [whatsapp-web.js](https://wwebjs.dev) (a "linked device", like WhatsApp Web). This is not an
official WhatsApp API. Use a dedicated number and keep the safety limits on.

---

## Contents

1. [Windows (Docker Desktop)](#1-windows-docker-desktop)
2. [Linux server (Ubuntu)](#2-linux-server-ubuntu)
3. [Settings (.env)](#3-settings-env)
4. [Using the app](#4-using-the-app)
5. [Troubleshooting](#5-troubleshooting)
6. [Development without Docker](#6-development-without-docker)
7. [How it works](#7-how-it-works)

---

## 1. Windows (Docker Desktop)

Run these in **PowerShell** in this folder (`wa-link-sender`).

**Check Docker Desktop is installed and running** (install from <https://www.docker.com/products/docker-desktop/>, WSL 2 backend):

```powershell
docker version
docker compose version
```

Both must print a *Server* / version section. If `docker version` shows an error about the engine, start Docker Desktop and wait until it says *Engine running*.

**Create your settings file** (first time only):

```powershell
Copy-Item .env.example .env
notepad .env        # set ACCESS_KEY (12+ characters); PORT is 3100 by default
```

Generate a strong key: `-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 32 | % {[char]$_})`

**Build and start** (runs in the background, restarts with Docker Desktop):

```powershell
docker compose up -d --build
docker compose ps          # STATUS should become "Up ... (healthy)" within a minute
```

Open **<http://localhost:3100>**, sign in with your `ACCESS_KEY`, then go to **Connection** and scan the QR code with the sending phone.

| Task | Command |
|---|---|
| View logs (live) | `docker compose logs -f app` |
| Stop | `docker compose down` (keeps the WhatsApp login and history) |
| Start again | `docker compose up -d` |
| Restart | `docker compose restart app` |
| Update after changing code / pulling | `docker compose up -d --build` |
| Update the WhatsApp library | change `whatsapp-web.js` in `package.json`, run `npm install`, then `docker compose up -d --build` |

> To keep it running after a reboot: Docker Desktop → Settings → General → **Start Docker Desktop when you sign in**. The container itself has `restart: unless-stopped`.

---

## 2. Linux server (Ubuntu)

**Install Docker Engine + Compose plugin** (official script):

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # then log out and back in
docker compose version
```

**Get the code and configure:**

```bash
git clone https://github.com/DathaCode/whatsapp-link-sender.git
cd whatsapp-link-sender/wa-link-sender
# (private repo? use a GitHub deploy key or a personal access token)
cp .env.example .env
nano .env                       # set ACCESS_KEY, check TZ / limits
```

**Run:**

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f app
```

The app listens on `127.0.0.1:3100` only, so it is **not** reachable from the internet by default.
To link the phone from your PC, use an SSH tunnel:

```bash
ssh -L 3100:127.0.0.1:3100 user@your-server
# then open http://localhost:3100 on your PC
```

### Optional: HTTPS on a domain (Caddy)

1. Point a DNS **A record** (e.g. `links.example.com`) at the server's IP.
2. Open ports 80 and 443 (`sudo ufw allow 80,443/tcp && sudo ufw allow 443/udp` if you use ufw).
3. Add to `.env`: `DOMAIN=links.example.com`
4. Start with the proxy profile:

```bash
docker compose --profile proxy up -d
```

Caddy gets and renews a free Let's Encrypt certificate automatically. The app is then at
`https://links.example.com`, and sign-in cookies are marked Secure. Stop the proxy with `docker compose --profile proxy down`.
Use a long `ACCESS_KEY` before exposing the app. Sign-in attempts are limited to 10 wrong tries per 15 minutes.

### Backups

All state lives in three named volumes:

| Volume | Contents |
|---|---|
| `wa-link-sender_wa_auth` | WhatsApp login (treat it like a password) |
| `wa-link-sender_app_data` | SQLite: history, queue, templates, group lists, settings |
| `wa-link-sender_wa_cache` | cached WhatsApp Web version (no need to back up) |

```bash
# Back up (stop briefly so the files are consistent)
docker compose stop app
docker run --rm -v wa-link-sender_app_data:/v -v "$PWD":/b alpine tar czf /b/app_data-$(date +%F).tgz -C /v .
docker run --rm -v wa-link-sender_wa_auth:/v  -v "$PWD":/b alpine tar czf /b/wa_auth-$(date +%F).tgz  -C /v .
docker compose start app

# Restore (into a fresh install, before first start)
docker compose create app
docker run --rm -v wa-link-sender_app_data:/v -v "$PWD":/b alpine sh -c "tar xzf /b/app_data-YYYY-MM-DD.tgz -C /v && chown -R 1000:1000 /v"
docker run --rm -v wa-link-sender_wa_auth:/v  -v "$PWD":/b alpine sh -c "tar xzf /b/wa_auth-YYYY-MM-DD.tgz -C /v && chown -R 1000:1000 /v"
docker compose up -d
```

On Windows PowerShell use `${PWD}` instead of `"$PWD"` and type the date by hand.

---

## 3. Settings (.env)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3100` | Web port (host and container) |
| `ACCESS_KEY` | *(required)* | Sign-in password for your team, 12+ characters |
| `TZ` | `Asia/Colombo` | Time zone for sending hours and the daily limit |
| `MIN_DELAY_SECONDS` / `MAX_DELAY_SECONDS` | `15` / `40` | Random pause between groups (minimum 5) |
| `DAILY_MESSAGE_CAP` | `150` | Max messages per day (1 group = 1 message, failures count too) |
| `SEND_WINDOW_START` / `SEND_WINDOW_END` | `08:00` / `21:00` | Sending hours. Outside them, sends wait. May cross midnight |
| `DOMAIN` | — | Only for the `proxy` profile |
| `LOG_LEVEL` | `info` | `debug` for more detail |

The safety values in `.env` are **defaults**. The **Settings** page can change them (stored in the
database) and has a *Use .env defaults* button. Every value is checked at start-up, and the app tells
you exactly what is wrong instead of starting with bad settings.

After editing `.env`: `docker compose up -d` (recreates the container with the new values).

---

## 4. Using the app

- **Connection**: status badge, QR code with steps, *Refresh groups*, *Unlink WhatsApp*.
- **Send**:
  1. Paste a link. The platform is detected and tracking parameters (`si`, `utm_*`, `fbclid`…) are removed.
  2. Pick a template, or *Mix it up* (rotates templates).
  3. Choose groups or a saved list. The button shows the estimated time.
  4. Progress updates live. You can close the page and sending continues.
- **History**: search, copy link, open it, see per-group results, *Retry failed groups*.
- **Settings**: today's usage, pauses, daily limit, sending hours, templates (`{url}` = the link), saved group lists.

**Safety tips:** use a separate number that has been used normally for a while. Only send to groups
where members expect your posts. Don't resend the same link. Keep pauses at 15 s or more.

---

## 5. Troubleshooting

**QR code doesn't appear**
- Wait up to a minute after start-up. Check `docker compose logs -f app` for `"state":"qr"`.
- If it says *Reconnecting* repeatedly, read `lastError` in the log. A whatsapp-web.js update often fixes start-up failures after WhatsApp changes its web app. Change `whatsapp-web.js` in `package.json` to the latest version, run `npm install`, then `docker compose up -d --build`.

**Chromium crashes / "Target closed" / "Protocol error"**
- The app restarts the browser itself, waiting longer each time (5 s up to 5 min). A watchdog also restarts it if the connection stops responding.
- Make sure `shm_size: 1gb` is still in `docker-compose.yml`, and that the machine has at least 1 GB of free RAM.
- "Browser is already running" errors come from leftover `SingletonLock` files. These are removed automatically at every start.

**Port already in use**
- Change `PORT` in `.env` (e.g. `PORT=3200`), then `docker compose up -d`. Find who uses a port: Windows `netstat -ano | findstr :3100`, Linux `sudo ss -ltnp | grep 3100`.

**Session lost (QR shown again after a restart)**
- The phone unlinked the device, or WhatsApp logged it out (phone offline for ~14 days, or removed under *Linked devices*). Scan again.
- Make sure you never ran `docker compose down -v`. The `-v` deletes the volumes, including the login.

**Reset the WhatsApp session completely**

```powershell
# Easiest: Connection tab → "Unlink WhatsApp", then scan the new QR.
# Or by hand (deletes only the login; history stays):
docker compose stop app
docker volume rm wa-link-sender_wa_auth
docker compose up -d
```

**A send is "Paused"**: it is outside sending hours, the daily limit is reached, or WhatsApp is
disconnected. It continues by itself and nothing is lost.

**A group shows "Can't post here"**: only admins can post there, or the number left the group.

**Running without Docker on Windows** and you see `Execution context was destroyed` right after start:
the project folder path is too long for Chromium's profile files (Windows 260-character limit).
Move the folder to a short path such as `C:\apps\wa-link-sender`. Docker is not affected.

---

## 6. Development without Docker

Needs Node.js 22+.

```powershell
npm install
npm --prefix web install
npm run build:web          # build the page once (served by the server)
npm run dev                # server with auto-reload on http://localhost:3100
npm run dev:web            # optional: Vite dev server on :5173 with hot reload (proxies /api)
npm test                   # unit tests
npm run typecheck
```

Without Docker, the session is stored in `./.wwebjs_auth` and the database in `./data`. Set `HEADLESS=false` to watch the browser.

---

## 7. How it works

```
Browser (React)  ── cookie session ──►  Express API  ──►  SQLite (data volume)
      ▲                                     │
      └──── Server-Sent Events (live) ◄─────┤
                                            ▼
                               Send queue (1 message at a time,
                               pause / cap / hours checks)
                                            │
                                            ▼
                    whatsapp-web.js ─► Chromium ─► WhatsApp Web
                    (LocalAuth session in wa_auth volume,
                     auto-reconnect with backoff + watchdog)
```

- `src/whatsapp.ts`: client lifecycle, QR code, reconnect, stale-lock cleanup, logout
- `src/queue.ts`: persistent send worker and safety rules
- `src/urls.ts`: link validation and clean-up
- `src/app.ts`: HTTP API, sign-in, SSE; `src/db.ts`: SQLite schema
- `web/`: React + Vite + Tailwind UI

This tool only sends to groups the number already belongs to. It has no feature for finding,
joining or scraping groups.
