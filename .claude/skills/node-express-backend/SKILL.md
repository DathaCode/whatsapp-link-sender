---
name: node-express-backend
description: "Node 22 + Express 5 + TypeScript backend patterns used in wa-link-sender: zod config validation with readable errors, httpOnly cookie sessions, rate-limited login, same-origin checks, helmet CSP, Server-Sent Events, structured pino logs, /healthz, graceful SIGTERM shutdown. Use when adding or changing API routes, auth, config, logging or process lifecycle code under src/."
---

# Node / Express backend

## When to activate
- New or changed route in `src/app.ts`, auth in `src/auth.ts`, config in `src/config.ts`
- Startup/shutdown code in `src/index.ts`; live updates (`src/events.ts`)

## Conventions
- **ESM + NodeNext**: relative imports end in `.js` (`import { x } from './db.js'`). CJS libs: `import pkg from 'lib'; const { A } = pkg;`.
- **Express 5**: async handlers may throw; errors reach the final error middleware (no try/catch boilerplate).
  Map known errors there: `ZodError`→400 (first issue message), `HttpError`→its status, `NotFoundError`→404,
  `NotConnectedError`→503. Unknown errors → log the stack, return a plain-language 500.
- **Validate every body/param with zod** at the route. Messages are user-facing: say what to do next.
- **Config**: all settings come from env, validated once in `parseConfig()`. On failure print a bullet
  list and `exit(1)`. Empty strings mean "use default". Never read `process.env` elsewhere.

## Auth model (v3: user accounts)
- Users + roles ADMIN/USER, argon2id via `@node-rs/argon2`, server-side sessions (token hash in SQLite, idle + absolute timeout),
  lockout per username (also for unknown names, generic messages), per-IP limiter on login. Routes are declared in one table with an
  access level; add new routes there (never `app.get` directly) so the role-enforcement test covers them automatically.
- The previous single ACCESS_KEY model below is historical.

## Auth model (v2, historical)
- Single shared `ACCESS_KEY`. Compare via `timingSafeEqual` on SHA-256 digests.
- Session token = 32 random bytes in an **httpOnly, SameSite=Strict** cookie (`secure: req.secure`);
  only the token's SHA-256 is stored in SQLite, bound to a fingerprint of the key (changing the key signs everyone out).
- Login limited with `express-rate-limit` (10 failures / 15 min, `skipSuccessfulRequests`).
- `sameOrigin` middleware: non-GET requests with a foreign `Origin` → 403; non-JSON bodies → 415.
- `trust proxy` = `loopback, uniquelocal` so Caddy on the Docker network sets `req.secure`.

## Live updates (SSE)
- `GET /api/events` (auth required). Send a snapshot on connect, then `whatsapp`, `queue`, `usage`, `groups`, `job` events.
- Headers: `text/event-stream`, `no-cache, no-transform`, `X-Accel-Buffering: no`. Heartbeat comment every 25 s.
- **No compression middleware** and no `encode` in Caddy: they buffer the stream.

## Security headers
- `helmet` with CSP `img-src 'self' data:` (QR is a data URL), **`upgrade-insecure-requests` disabled**
  (it breaks plain-http LAN access), HSTS left to the HTTPS proxy.

## Logging
- `pino` JSON to stdout (Docker json-file driver rotates 10 MB × 3). Child loggers per module (`mod`).
- Never log secrets: the key, cookies. Log failed logins with IP.

## Lifecycle
- `/healthz` is public, cheap, always 200 while the process is alive. It includes the WhatsApp state but
  does **not** fail when unlinked (a QR wait is healthy).
- SIGTERM/SIGINT: close HTTP + SSE → let the in-flight send finish (≤15 s) → `client.destroy()` → close DB → exit 0.
  Force-exit after 25 s (compose `stop_grace_period: 30s`).
- `EADDRINUSE` → print "Port N is already in use. Set a different PORT in .env".

## Testing
- `vitest` in `test/`. Pure units (urls, time, config, templates) + queue tests with a fake WhatsApp and a temp SQLite dir.
- Run: `npm test`, `npm run typecheck`.
