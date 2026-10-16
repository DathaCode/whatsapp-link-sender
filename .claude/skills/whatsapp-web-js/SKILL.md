---
name: whatsapp-web-js
description: "whatsapp-web.js (linked-device WhatsApp Web automation via Puppeteer/Chromium): client lifecycle, LocalAuth sessions, QR flow, reconnect/backoff, Chromium in Docker, stale profile locks, sending safely to groups, ban-risk limits and known breakages. Use whenever touching src/whatsapp.ts, src/queue.ts, puppeteer options, the session volume, or debugging QR/connection/send failures."
---

# whatsapp-web.js

## When to activate
- Editing `src/whatsapp.ts` (client lifecycle) or `src/queue.ts` (sending)
- QR not showing, "Execution context was destroyed", "Target closed", auth failures, session lost
- Upgrading `whatsapp-web.js` or changing Chromium / puppeteer options
- Anything that changes how often or how much the number sends

## Version facts (verify with the researcher skill before relying on them)
- Pinned: `whatsapp-web.js@1.34.7` (Oct 2026 latest). It bundles puppeteer 24.x; in Docker we skip its
  browser download and use Debian's `chromium` (`PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`).
- Upstream reports: 1.34.6+ `sendSeen` can throw `getLastMsgKeyForAction is not a function` →
  **always send with `{ sendSeen: false }`**. Long sessions can die with "Execution context was destroyed" →
  we run a watchdog (`getState()` every 60 s, restart after 3 failures).
- **Don't use `client.getChats()` / `getChatById()` on 1.34.7.** `getChatModel()` loads each chat's last message and
  WhatsApp Web throws `DataError: ... IDBObjectStore: No key or key range specified` (surfaces as a bare `"r"` error).
  We read groups straight from `window.require('WAWebCollections').Chat.getModelsArray()` in `listGroups()`, and send the
  typing indicator with `window.WWebJS.sendChatstate()`. `client.sendMessage()` is fine (it uses `getAsModel:false`).
- **`client.sendMessage()` returns `undefined` for messages that WERE sent** (1.34.7): after sending it re-reads the message by
  the id it generated (`Msg.get(newMsgKey)`), but WhatsApp Web stores group messages under a different (LID-based) key.
  Never treat a falsy return as failure. We check the chat exists first (`WWebJS.getChat(id, {getAsModel:false})`), then treat
  "no exception" as sent. (Found in prod 2026-10-16: links were delivered but logged as "chat not found".)
- **WhatsApp Communities** (src/groups.ts `classifyGroups`, unit-tested): the Community is a parent group (`isParentGroup`, can't post);
  its Announcements group is `defaultSubgroup` (subject = Community name → duplicate "Hiru News" names; only Community admins post);
  other groups carry `parentGroup` = Community id; parents list `unjoinedSubgroups`. Field names are read from
  `groupMetadata.serialize()` with fallbacks; if WhatsApp renames them, the admin "Diagnose group list" action (POST
  /api/admin/groups/debug, also logs `group debug <id>` lines) shows every raw key (`rawKeys`).
- Refresh = `GroupMetadata.update(wid)` per group (batches of 8, 15 s each) before reading, i.e. fresh from WhatsApp; groups whose
  `chat.groupMetadata` isn't loaded yet are no longer skipped.
- Group participants are identified by **LID** (`…@lid`), not phone numbers, so never match "me" by phone.
  Use `groupMetadata.participants.iAmMember()` / `iAmAdmin()` / `iAmSuperAdmin()`. The library's `isReadOnly` is just `announce`.
- Right after linking, the chat list can be empty for a few seconds, so group loading retries (0/10/30/90 s).
- Debug the live page: Chromium writes `<authDir>/session/DevToolsActivePort`; inside the container,
  `puppeteer.connect({ browserURL: 'http://127.0.0.1:<port>' })` (NODE_PATH=/app/node_modules) and `page.evaluate` probes.
  From Git Bash, set `MSYS_NO_PATHCONV=1` before `docker compose exec` with container paths.
- Check `npm view whatsapp-web.js version` and the GitHub issues before upgrading; WhatsApp Web changes break it often.

## Lifecycle rules (learned the hard way)
1. **Never call `client.initialize()` on a client whose browser died.** Destroy it and build a new `Client`.
   Re-initializing launches a second Chromium on the same profile → "browser already running" → crash.
2. **Always `.catch()` `initialize()`**, and register `process.on('unhandledRejection')`. The library's own
   `framenavigated` listener can reject; unhandled, that kills Node (this was the original crash).
3. Use a **generation counter**: every (re)start increments it; event handlers from older clients are ignored.
4. Backoff: 5 s × 2^n, max 5 min, plus jitter; reset on `qr` or `ready`. Logout/unpair restarts after 1 s with a wiped session.
5. Wrap `initialize()` in a timeout (3 min). `page.goto` uses `timeout: 0` internally and can hang forever.
6. On startup remove `SingletonLock`, `SingletonSocket`, `SingletonCookie` from `<authDir>/session/`
   using `lstat` (they are often dangling symlinks; `existsSync` returns false for them).
7. Graceful stop: `client.destroy()` with a timeout, then SIGKILL the browser process if it hangs.
   Compose uses `init: true` (tini) so zombie Chromium processes are reaped.

## Session / storage
- `LocalAuth({ dataPath })` stores the Chromium profile at `<dataPath>/session`. Persist it in a named volume.
- `webVersionCache: { type: 'local', path }` caches WhatsApp Web HTML; separate volume, safe to lose.
- `auth_failure` → wipe the session dir and restart (shows a new QR).
- `disconnected` with `LOGOUT`/`UNPAIRED` → phone removed the device → wipe + new QR.
- **Windows-only gotcha:** a long project path pushes Chromium's IndexedDB files past MAX_PATH (260).
  WhatsApp then logs out instantly (`?post_logout=1`) and `inject()` throws "Execution context was destroyed".
  Fix: short path (e.g. `C:\apps\...`). Docker paths (`/app/.wwebjs_auth`) are not affected.
- The library's default user agent (Chrome/101 Mac) is required for the QR to render in headless mode;
  plain "HeadlessChrome" UA gets no QR. Don't override `userAgent` unless you test the QR again.

## Sending safely (ban-risk controls, all server-side)
- Only `@g.us` ids, and only groups already in our cached list (`getChats()` → `isGroup`). No joining/finding/scraping features.
- One message in flight at a time, random pause (default 15–40 s, floor 5 s) between messages, daily cap,
  sending-hours window in `TZ`, duplicate-URL confirm, template rotation (avoid identical text).
- Show "typing…" (`chat.sendStateTyping()`) 1.5–4 s before sending; cosmetic, ignore failures.
- `readOnly` groups (announce-only and we're not admin, or we left) are skipped with a clear error.
- A message marked `sending` at restart is marked **failed**, never resent automatically (no double posts).
- If a send throws while the client is not ready → put the item back to `pending` (not the group's fault).

## Debugging checklist
1. `docker compose logs -f app`: look at `"mod":"whatsapp"` lines: state changes, `lastError`, restart delays.
2. `GET /healthz` → `whatsapp` state (`starting|qr|authenticating|ready|reconnecting`).
3. QR never appears: try `HEADLESS=false` locally (non-Docker) to watch the page; check upstream issues for the current WhatsApp Web build.
4. Repro outside the app with a 10-line probe script (new Client + `qr` handler) before changing app code.
