# wa-link-sender

Write or paste a full post (text, links, emoji, an optional image) into a web page and send it to
WhatsApp groups that your own WhatsApp number is **already a member of**. Runs 24/7 in Docker, on
Windows (Docker Desktop) or a Linux server.

- **Exact text.** Sinhala (including the zero-width joiner), styled letters like 𝗙𝗢𝗟𝗟𝗢𝗪, emoji and blank lines are sent exactly as typed. Only tracking parameters (`si`, `utm_*`, `fbclid`…) are removed from links.
- **Optional image.** JPG, PNG or WebP up to 5 MB, re-encoded with all metadata removed, sent with the text as its caption.

- **User accounts with two roles.** Admins manage everything. Users can only send to the presets (group lists) they were given and see their own history.
- **Managed WhatsApp numbers.** Link numbers by QR code, choose the one active number, and see status, possible bans and per-number stats.
- **Complete audit log.** Every sign-in, change, refused request and per-group send result is recorded and append-only, with a searchable Logs page and CSV export.
- **Safety rules enforced on the server.** Random pause between groups (default 15–40 s, 30–90 s with an image), a daily limit per number, sending hours, duplicate warnings (same text, same image or same main link), allowed link domains, and one message at a time.
- Pending sends survive restarts. Nightly database backups are made automatically.

It uses [whatsapp-web.js](https://wwebjs.dev) (a "linked device", like WhatsApp Web). This is not an
official WhatsApp API. Use dedicated numbers and keep the safety limits on.

---

## Contents

1. [First run: Windows (Docker Desktop)](#1-first-run-windows-docker-desktop)
2. [First run: Linux server (Ubuntu)](#2-first-run-linux-server-ubuntu)
3. [Settings (.env)](#3-settings-env)
4. [Users and roles](#4-users-and-roles)
5. [Adding or replacing a WhatsApp number](#5-adding-or-replacing-a-whatsapp-number)
6. [Reading and exporting logs](#6-reading-and-exporting-logs)
7. [Backup and restore](#7-backup-and-restore)
8. [Forgotten admin password](#8-forgotten-admin-password)
9. [Troubleshooting](#9-troubleshooting)
10. [Development and tests](#10-development-and-tests)
11. [How it works](#11-how-it-works)

---

## 1. First run: Windows (Docker Desktop)

Run in **PowerShell** in this folder (`wa-link-sender`). Docker Desktop must be running (`docker version` shows a *Server* section).

```powershell
Copy-Item .env.example .env
notepad .env
```

Set at least:

| Variable | What to put |
|---|---|
| `SESSION_SECRET` | a long random value: `[Convert]::ToBase64String((1..48 \| % {Get-Random -Max 256}))` |
| `INITIAL_ADMIN_USERNAME` | e.g. `admin` |
| `INITIAL_ADMIN_PASSWORD` | 10+ characters (temporary; you change it at first sign-in) |

```powershell
docker compose up -d --build
docker compose ps            # wait for "Up ... (healthy)"
```

Open **<http://localhost:3100>** and sign in with the initial admin, then choose your own password. Then:

1. Open **Connections**, choose **Add number** and scan the QR code with the sending phone ([details](#5-adding-or-replacing-a-whatsapp-number)).
2. Open **Groups & Presets**: the groups load automatically. Create presets such as "Sinhala groups".
3. Open **Users**: create accounts for your team and tick the presets each person may use.

| Task | Command |
|---|---|
| Logs (live) | `docker compose logs -f app` |
| Stop / start | `docker compose stop` / `docker compose start` |
| Update after pulling new code | `docker compose up -d --build` |

---

## 2. First run: Linux server (Ubuntu)

```bash
curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker $USER   # log out/in afterwards
git clone https://github.com/DathaCode/whatsapp-link-sender.git
cd whatsapp-link-sender/wa-link-sender
cp .env.example .env
sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$(openssl rand -base64 48 | tr -d '\n')|" .env
nano .env                       # set INITIAL_ADMIN_USERNAME / INITIAL_ADMIN_PASSWORD, check TZ
chmod 600 .env
docker compose up -d --build
docker compose ps
```

The app listens on `127.0.0.1:3100` only. Reach it through an SSH tunnel from your PC
(`ssh -L 3101:127.0.0.1:3100 user@server`, then open <http://localhost:3101>), or publish it with HTTPS:

```bash
echo 'DOMAIN=links.example.com' >> .env      # DNS A record must point to the server
sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw allow 443/udp
docker compose --profile proxy up -d
```

Caddy gets a free certificate automatically. Behind it, cookies are marked *Secure* and the audit log
records the real client IP (`TRUST_PROXY` trusts the private Docker network by default).

---

## 3. Settings (.env)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3100` | Web port |
| `TZ` | `Asia/Colombo` | Time zone for sending hours, daily limits, nightly jobs and how times are shown |
| `INITIAL_ADMIN_USERNAME` / `INITIAL_ADMIN_PASSWORD` | — | Creates the first admin **only when no users exist**. They must change the password at first sign-in |
| `SESSION_SECRET` | *(required)* | 32+ random characters; signs the anti-CSRF tokens |
| `SESSION_IDLE_HOURS` | `8` | Sign out after this long without activity |
| `SESSION_MAX_DAYS` | `7` | Sign out after this long in any case |
| `LOGIN_MAX_ATTEMPTS` / `LOGIN_LOCK_MINUTES` | `5` / `15` | Lock an account (or attempted username) after this many wrong passwords |
| `TRUST_PROXY` | `loopback, uniquelocal` | Which proxies may report the client IP: `false`, `true`, a hop count, or address list |
| `AUDIT_RETENTION_DAYS` | `365` | Audit entries older than this are removed nightly (minimum 30) |
| `BACKUP_KEEP` | `14` | Nightly database backups to keep |
| `UPLOAD_RETENTION_DAYS` | `90` | Attached images are deleted after this many days (history shows “image expired”) |
| `MIN_DELAY_SECONDS` / `MAX_DELAY_SECONDS` | `15` / `40` | Random pause between groups (minimum 5) |
| `DAILY_MESSAGE_CAP` | `150` | Max messages per WhatsApp number per day |
| `SEND_WINDOW_START` / `SEND_WINDOW_END` | `08:00` / `21:00` | Sending hours; outside them sends wait |
| `DOMAIN` | — | Only for the `proxy` profile |

The safety values in `.env` are defaults. Admins can change them on **Settings**, and every change is
audit-logged with before and after values. After editing `.env`, run `docker compose up -d`.

### Settings page (admins)

| Setting | Default | Meaning |
|---|---|---|
| Pause between groups | 15–40 s | Random pause for text-only posts |
| Pause for posts with an image | 30–90 s | Random pause when an image is attached |
| How to send a post with an image | One message | **One message:** image + caption (≤1,024 characters, links show as plain links). **Two messages:** image, then the text (keeps the link preview card; counts 2 against the daily limit) |
| Allowed sites | hiru.lk, hirunews.lk, youtube.com, youtu.be, facebook.com, fb.watch, tiktok.com | Users can only send links to these (and their subdomains); admins must confirm others |
| Repeating links | the YouTube / Facebook / TikTok profile links | Links in every post; never count as “already sent” |
| Snippets | “Follow us footer” | Reusable text blocks everyone can insert on the Send page |

## Sending a post

1. **Message:** write or paste the whole post. The counter shows characters against WhatsApp’s limit
   (65,536 for a text message, 1,024 for an image caption). Links appear below as chips: *allowed* or
   *not allowed*, *cleaned* when tracking was removed, *footer* when they don’t count for duplicates.
   Use the snippet buttons to insert the footer at the cursor. The draft is saved on the server as you type.
2. **Image (optional):** drag it in, click to choose, or press **Ctrl+V** anywhere on the page.
3. **Groups:** pick presets / groups as before.
4. Check the **preview** (WhatsApp formatting: `*bold*`, `_italic_`, `~strike~`), press **Send**, and confirm.

You’re warned before resending something that looks like an earlier post: the same text (ignoring
spacing), the same image, or the same *main* link. Footer links never trigger this.

---

## 4. Users and roles

| | ADMIN | USER |
|---|:-:|:-:|
| Send | any group on the active number | only groups in presets assigned to them |
| History | everyone's | their own |
| Dashboard, Users, Connections, Groups & Presets, Settings, Logs | ✓ | — |

These rules are enforced by the server on every request. A user who tries an admin address gets *403*,
and the attempt is recorded in the audit log.

- **Create a user:** Users → *New user*. A temporary password is shown **once**. The user sets their own at first sign-in.
- **Reset a password:** creates a new temporary password and signs the user out everywhere.
- **Disable:** the user is signed out and cannot sign in. Users are never deleted, so their history stays attributed.
- **Last admin protection:** the last active admin cannot be disabled or made a USER.
- **Passwords:** at least 10 characters, cannot reuse the current one, stored with argon2id.
- **Lockout:** 5 wrong passwords lock that username for 15 minutes. Messages never reveal whether a username exists.

---

## 5. Adding or replacing a WhatsApp number

Only **one number is active** at a time, and it sends everything. The app never switches numbers by
itself. If the active number disconnects, is logged out or may be banned, **sending pauses**. Admins
see a red banner, and users see "Sending is paused, please contact your admin."

**Add a number:**
1. Connections → **Add number** → give it a name → **Show QR code**.
2. On the phone: WhatsApp → **Linked devices** → **Link a device** → scan. The code expires after 5 minutes (use *Show QR again*).
3. The first number becomes active automatically. Later numbers go to **Standby**: their login is saved, but they don't run.

**Replace the active number** (for example, it was banned):
1. Add the new number as above (it goes to Standby).
2. Make sure the new number is a member of your groups.
3. Choose **Make active** on it. The old one goes to Standby.
4. Open **Groups & Presets** and choose **Refresh groups**. Presets show a warning for groups the new number isn't in.

**Statuses:** *Connected* · *Standby* · *Reconnecting…* (temporary; it retries by itself) · *Logged out*
(unlinked from the phone, or WhatsApp ended the session) · *Possibly banned* (WhatsApp reported a block) ·
*Removed* (session deleted; history kept).

**Re-link** shows a fresh QR code for the same entry. **Remove** signs the number out of WhatsApp,
deletes its saved login and keeps it in the list as *Removed*.

Each number keeps its login in its own folder (`.wwebjs_auth/session-<id>`) inside the `wa_auth` volume.

---

## 6. Reading and exporting logs

**Logs** (admins) shows the audit trail, newest first. Failed entries have a red edge and denied entries an amber one.

- Filter by date range, user, category (sign-in, blocked requests, users, numbers, groups, presets, settings, sending, system), outcome, WhatsApp number, or free text such as an IP, URL or group name.
- Click a row to see everything: UTC time, user and role, IP, browser, session id, target, reason, and the JSON details (for changes, before and after values; never passwords).
- **Export CSV** downloads the rows that match the current filters. The export itself is logged.
- Rows cannot be edited or deleted. The database refuses it. Entries older than `AUDIT_RETENTION_DAYS` are pruned nightly, and that is logged too.

Application logs (`docker compose logs app`) are JSON lines. Each audit event is mirrored there, but the
audit log in the database is the source of truth.

---

## 7. Backup and restore

**Automatic:** every night at 02:30 (`TZ`) the database is copied with `VACUUM INTO` to
`data/backups/` inside the `app_data` volume. The newest `BACKUP_KEEP` copies are kept.

**From the app:** Settings → Backups → *Back up now* and *Download*. Downloads are audit-logged.
Store downloads safely, because they include password hashes and the audit log.

**Restore the database** (users, presets, history, audit log, settings):

```powershell
docker compose stop app
docker compose cp .\app-20261016-023000.sqlite app:/app/data/restore.sqlite
docker compose run --rm --entrypoint sh app -c "rm -f /app/data/app.sqlite-wal /app/data/app.sqlite-shm && mv /app/data/restore.sqlite /app/data/app.sqlite"
docker compose start app
```

**WhatsApp logins** are in the separate `wa_auth` volume and are not inside the database backup. To
move them to another server, see the volume commands below. Or simply re-link the numbers.

```bash
# Whole-volume backup (Linux; stop the app first for a consistent copy)
docker compose stop app
docker run --rm -v wa-link-sender_app_data:/v -v "$PWD":/b alpine tar czf /b/app_data.tgz -C /v .
docker run --rm -v wa-link-sender_wa_auth:/v  -v "$PWD":/b alpine tar czf /b/wa_auth.tgz  -C /v .
docker compose start app
```

Never run `docker compose down -v`: `-v` deletes the volumes.

---

## 8. Forgotten admin password

```bash
docker compose exec app node dist/cli.js reset-admin            # INITIAL_ADMIN_USERNAME, or the oldest admin
docker compose exec app node dist/cli.js reset-admin someone    # a specific account
```

It re-enables and unlocks the account, makes sure it is an admin, prints a **temporary password** and
signs out its sessions. Sign in with that password, and you'll be asked to choose a new one. The reset is audit-logged.

---

## 9. Troubleshooting

**"cannot start because of these settings problems"**: the message lists each bad value. Fix `.env`, then `docker compose up -d`.

**"No users exist yet. Set INITIAL_ADMIN_USERNAME…"**: first start without an initial admin. Add both values to `.env`.

**QR doesn't appear / keeps reconnecting**: check `docker compose logs -f app` for `connection.*` entries and their reasons. WhatsApp Web changes often. Updating `whatsapp-web.js` in `package.json`, then `npm install` and `docker compose up -d --build`, usually fixes start-up failures.

**Chromium crashes**: the app restarts it with a growing delay and a watchdog. Keep `shm_size: 1gb` and give the server at least 2 GB RAM. Stale `SingletonLock` files are removed at start.

**"Your page is out of date. Reload it"**: the anti-CSRF token didn't match (for example, after `SESSION_SECRET` changed). Reload the page.

**Everyone shows the same IP in the logs**: with plain Docker port mapping (Docker Desktop), Docker hides the client address. Behind the Caddy proxy the real IP is recorded.

**Port already in use**: change `PORT` in `.env`, then `docker compose up -d`.

**Upgrading from the single-access-key version**: this version uses a new database file (`app.sqlite`) and new per-number session folders. Old history isn't imported. `ACCESS_KEY` is no longer used. Re-link your number on the Connections page, and on the phone remove the old linked device under *Linked devices*.

---

## 10. Development and tests

Needs Node.js 22+.

```powershell
npm install; npm --prefix web install
npm run build:web
npm run dev                  # server on :3100 (uses .env)
npm run dev:web              # optional: Vite on :5173 with hot reload
npm test                     # 70 tests: roles on every route, lockout, audit coverage, presets, last admin, queue
npm run typecheck
npm run db:generate          # after editing src/db/schema.ts: creates a new migration in drizzle/
```

---

## 11. How it works

```
Browser (React) ── session cookie + CSRF header ──► Express routes (one table, access level per route)
      ▲                                                  │  role guard → 403 + audit
      └──── Server-Sent Events (per user / role) ◄───────┤
                                                         ▼
     UserService · Catalog (presets, snippets) · Composer · Images · Settings · AuditLog (append-only) · Backups · Scheduler
                                                         │
                         SendQueue (1 message at a time, pause / per-number cap / hours)
                                                         │
                    ConnectionManager ── active number ──► WaClient (whatsapp-web.js + Chromium)
                    (linking browser only while showing a QR; others on standby)
                                                         │
                       SQLite via Drizzle ORM (WAL, migrations in drizzle/, runs on start-up)
```

- `src/db/schema.ts`: tables (users, sessions, connections, groups, presets, preset_access, snippets, drafts, uploads, jobs, job_main_links, send_results, audit_log)
- `src/http/`: routes and guards (`routes-auth.ts`, `routes-send.ts`, `routes-admin.ts`)
- `src/users.ts`, `src/auth/`: accounts, argon2id, sessions, lockout
- `src/connections.ts`, `src/whatsapp.ts`: numbers and the WhatsApp client
- `src/message.ts`, `src/compose.ts`: exact text, link cleanup, allowed domains, duplicate keys, limits
- `src/images.ts`: image checks, re-encoding, metadata removal, retention
- `src/queue.ts`, `src/jobs.ts`: sending and results
- `src/audit.ts`, `src/backups.ts`, `src/scheduler.ts`: audit log, backups, nightly jobs
- `src/cli.ts`: `reset-admin`

This tool only sends to groups the number already belongs to. It has no feature for finding,
joining or scraping groups.
