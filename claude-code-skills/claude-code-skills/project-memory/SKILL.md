---
name: project-memory
description: "Living memory for the wa-link-sender project in stdrd/: goals, hard constraints, decisions with dates and reasons, what was broken and how it was fixed, verification status and open items. Read at the start of any session working in stdrd/, and update it whenever a decision is made, a gotcha is found, or verification status changes."
---

# wa-link-sender: project memory

> Keep this file current. Add dated entries; don't silently rewrite history. Never store secret values here.

## What it is
Team tool: paste a Facebook / TikTok / YouTube post URL → send it to WhatsApp **groups our own number is
already in**, via whatsapp-web.js (linked device). Code: `stdrd/wa-link-sender/`. Scope of work: only `stdrd/`.

## Hard constraints (from the owner)
- No feature for finding, joining or scraping groups. (`../public-groups/` is outside scope; don't touch or integrate it.)
- No paid services. Keep it simple and maintainable by one person.
- **Ask before major architecture changes** beyond the agreed plan.
- Port 3000 is taken on the owner's PC → default `PORT=3100`.
- Must run 24/7 in Docker on Windows (Docker Desktop/WSL2) now, Ubuntu + Docker Engine later.
- If something needs the phone (QR scan), stop and tell the owner exactly what to do.

## Stack (decided 2026-10-15)
- Backend: Node 22 + Express 5 + **TypeScript** (owner chose TS everywhere), zod, pino, better-sqlite3, whatsapp-web.js **1.34.7** (pinned exact).
- Frontend: React 19 + Vite 8 + Tailwind 4 (`web/`), sonner toasts, lucide icons, self-hosted Figtree font.
  One accent colour: persimmon (`#c2410c` light / `#fb8a4c` dark) on warm neutrals; dark mode follows the system.
- Docker: `node:22-bookworm-slim` multi-stage. **Owner approved Node 22 instead of the brief's Node 20** (Node 20 EOL April 2026; better-sqlite3 13 and vitest 5 need ≥ 22).
  Debian `chromium` (v155 in bookworm at the time), non-root `node` user, `init: true`, `shm_size: 1gb`, healthcheck, json-file 10m×3.
- Optional Caddy 2.11 under compose profile `proxy` (HTTPS, `DOMAIN` in .env).

## What was broken in the original app (fixed 2026-10-15)
1. `client.initialize()` had no `.catch()` → any start-up rejection (e.g. "Execution context was destroyed") **killed the whole Node process**.
2. On `disconnected` it called `initialize()` again on the same dead client → second Chromium on the same profile.
3. `/api/send` awaited `getChats()` outside try/catch → unhandled rejection crash on errors.
4. Access key kept in `localStorage` and sent as a header; no rate limit; delays 5–12 s; history was a JSON file.
5. Windows-only: long folder paths exceed MAX_PATH for Chromium profile files → instant WhatsApp logout loop.
   (Reproduced in a deep scratch folder; the real project path is short enough.)

## Key behaviours (keep them)
- Every reconnect builds a **new** Client; generation counter ignores stale events; backoff 5 s→5 min; watchdog every 60 s.
- Stale `Singleton*` locks removed at start (verified after `docker kill`).
- Sends: one at a time, server-side pause/cap/hours, duplicate confirm, template rotation, `sendSeen:false`, typing indicator.
- Interrupted (`sending`) items become **failed** on restart; never auto-resent.
- Safety values in `.env` are defaults; Settings page overrides are stored in SQLite (`settings.safety`).

## Verification status
- 2026-10-15: unit tests 35/35 pass (`npm test`); typecheck clean (server + web).
- Docker build OK (image ~1.6 GB, mostly Chromium + fonts). Container healthy; QR appears ~5–15 s after start at http://localhost:3100.
- Verified: graceful SIGTERM restart, stale-lock cleanup after hard kill, queued job survives restart (waits `whatsapp_offline`),
  duplicate warning (409), cross-origin POST blocked, login cookie flow, UI on phone and desktop in light and dark.
- 2026-10-15 (owner linked phone "~Hiru News Alerts"): session **survives restarts and rebuilds** (verified twice, no QR).
- 2026-10-15 bug found by owner: groups never loaded and "Refresh groups" gave a 500. Cause: whatsapp-web.js 1.34.7 `getChats()`
  crashes inside WhatsApp Web (IndexedDB DataError while loading last messages). Fixed by reading the chat collection directly
  (see whatsapp-web-js skill). Also fixed admin/membership detection (participants are LIDs now) and added group-load retries.
  Verified: test group "10th dev" loads on reconnect and via Refresh.
- **Pending:** owner to confirm a real send to the test group arrives (Send tab).

## v3: users, roles, connections, audit (2026-10-16, branch feature/users-roles-audit, not committed)
- Owner decisions: **fresh start** (new DB file `app.sqlite`; old `app.db` + old `session/` folder left unused);
  **only the active number runs** (a temporary browser only while showing a QR; others `standby`); admins add/activate numbers,
  never automatic switching; users pick **assigned presets and may untick groups**; **daily cap is per connection**.
- Stack additions: Drizzle ORM (sqlite-core, migrations in `drizzle/`, run on start), `@node-rs/argon2` (argon2id, prebuilt, no build tools),
  supertest for HTTP tests. Dockerfile change: only `COPY drizzle ./drizzle` into the runtime image.
- Every route is declared once in a table with an access level (`public | signed_in | user | admin`) in `src/http/*`; the guard does
  session → CSRF (`X-CSRF-Token` = HMAC(SESSION_SECRET, session id)) → forced-password-change → role. Any 403 is audited as `access.denied`.
- Audit log: append-only (no update code path; SQLite triggers block UPDATE and DELETE of rows < 30 days). `send_results.audit_id` links each
  per-group result to its `send.result` row. Pruning (AUDIT_RETENTION_DAYS) and nightly `VACUUM INTO` backups (02:30 TZ) run via `src/scheduler.ts`.
- `reset-admin` CLI: `docker compose exec app node dist/cli.js reset-admin [username]`.
- Verified 2026-10-16: 70 tests (roles on every route, lockout, audit coverage of all required actions, presets, last admin, queue);
  Docker build + healthy; E2E in browser: forced password change, user creation, USER → admin API = 403 and logged, Logs filter/expand/CSV,
  connection QR appears. **Pending: owner scans the QR** (Connections → Show QR again), then refresh groups, create presets, assign to users.
- Docker Desktop port-mapping hides client IPs (audit shows 172.x gateway); behind Caddy the real IP is recorded via TRUST_PROXY.
- E2E left a test USER `nimali` in the owner's local DB (disable it if unwanted; users are never deleted).

## UI theme: WhatsApp look (2026-10-16)
- Owner asked for original WhatsApp colours + logo. Decisions: **WhatsApp Web shell** (desktop icon rail + panel header; mobile green
  top bar with tabs; sign-in on a green band), and **WhatsApp logo + the name "Link Sender · for WhatsApp"** so it isn't mistaken for
  official WhatsApp (Meta trademark).
- Tokens in `web/src/index.css`: light teal `#008069` (buttons/text, passes contrast), brand `#25D366`, bubbles `#d9fdd3`, wallpaper
  `#efeae2`; dark `#0b141a`/`#1f2c33`/`#2a3942`, accent `#00a884` with dark ink, bubble `#005c4b`. System font stack (Segoe UI…), Figtree removed.
- Logo: `web/src/components/Logo.tsx` + `web/public/favicon.svg` (Simple Icons CC0 glyph on a green bubble); owner's 24×24 PNG is the
  fallback `favicon.png`. Shell lives in `web/src/Shell.tsx`; Send preview is a real outgoing bubble (`ChatBubble.tsx`).

## Open ideas / not done
- Healthcheck doesn't auto-restart an unhealthy container on plain Docker (only marks it); the in-app watchdog covers WhatsApp hangs.
- `npm audit` flags `basic-ftp`/`extract-zip` from puppeteer's browser downloader. Not used at runtime in Docker (download skipped).

## Useful commands
```powershell
cd F:\projects\whatsapp-automation\stdrd\wa-link-sender
docker compose up -d --build ; docker compose ps ; docker compose logs -f app
npm test ; npm run typecheck
curl http://localhost:3100/healthz
```
