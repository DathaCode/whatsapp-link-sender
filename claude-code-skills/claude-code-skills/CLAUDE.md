# CLAUDE.md: stdrd workspace (wa-link-sender)

<!-- Source of truth: stdrd/claude-code-skills/claude-code-skills/CLAUDE.md
     Installed copy:  stdrd/CLAUDE.md  (run claude-code-skills/sync-skills.ps1 after editing) -->

## Who I am
Solo full-stack developer and DevOps engineer. I build, deploy and run my apps myself.
Keep everything simple, automatable and maintainable by one person. Default to the cheapest viable option.

## This workspace
- Work **only inside `stdrd/`**. The app is `stdrd/wa-link-sender/` (see its README.md).
- Project memory (goals, constraints, decisions, gotchas, verification status) lives in the
  **`project-memory`** skill. Read it at the start of a session, and update it when something is decided or learned.
- Hard rules: no features that find, join or scrape WhatsApp groups. No paid services. Ask before major
  architecture changes. If a step needs the owner's phone (QR scan), stop and give exact instructions.

## Stack
Node 22 · TypeScript · Express 5 · better-sqlite3 · whatsapp-web.js (Chromium) · React 19 + Vite + Tailwind 4 ·
Docker Compose (Docker Desktop on Windows now, Ubuntu + Docker Engine later) · optional Caddy for HTTPS.

## Skills (installed in `stdrd/.claude/skills/`)
| Skill | Use it when |
|---|---|
| `project-memory` | Start of every session; after any decision, fix or verification |
| `whatsapp-web-js` | Client lifecycle, QR, reconnect, sending, Chromium, session volume |
| `node-express-backend` | Routes, auth, config validation, SSE, logging, shutdown |
| `sqlite` | Schema/migrations, queue semantics, backups |
| `docker` | Dockerfile, compose, volumes, healthchecks, container debugging |
| `react` / `typescript` | Anything in `web/` or any `.ts` file |
| `security` | Every change (secrets, auth, input, headers, container hardening) |
| `researcher` | Before adding or upgrading a dependency, or for unfamiliar errors |
| `self-healing` | Whenever something fails; record new gotchas in `project-memory` |
| `cost-reducer` | Hosting or service choices |
| `github` | Repo setup, CI, commits and PRs |

## Rules for Claude Code
1. Read the relevant skill before writing code or config, and apply `security` to everything.
2. Verify versions with `researcher` (npm view, changelogs, engines) instead of relying on memory.
3. When something fails, follow `self-healing`: find the root cause, don't repeat the same command, escalate after 3 approaches.
4. Never hardcode or print secrets. `.env` holds them, and `.env.example` documents every variable.
5. Before calling a change done: `npm test`, `npm run typecheck`, `docker compose up -d --build`,
   `docker compose ps` shows **healthy**, and `curl http://localhost:3100/healthz` works.
6. Keep the README and `.env.example` in sync with behaviour changes.
7. Update the `project-memory` skill at the end of meaningful work (dated entries).

## Conventions
- Repos and folders `kebab-case`. Branches `feature/…`, `fix/…`, `hotfix/…`.
- Environments: `dev` (local npm), `prod` (Docker). Port **3100** (3000 is taken on the dev PC).
- Time zone default `Asia/Colombo`.
