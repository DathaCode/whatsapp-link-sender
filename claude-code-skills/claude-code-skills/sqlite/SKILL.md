---
name: sqlite
description: "SQLite with better-sqlite3 for small self-hosted apps: WAL mode, user_version migrations, transactions, persistent job queues that survive restarts, backups of the Docker data volume. Use when changing src/db.ts, adding tables/columns, writing queries, or backing up/restoring data."
---

# SQLite (better-sqlite3)

## When to activate
- Schema or query changes in `src/db.ts`
- Anything about the persistent send queue, history, usage counting
- Backups, restores, or inspecting data in a running container

## Setup (already in `Store` constructor)
```ts
db.pragma('journal_mode = WAL');   // readers don't block the writer
db.pragma('synchronous = NORMAL'); // safe with WAL, much faster
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
```
The file lives at `$DATA_DIR/app.db` (+ `-wal`, `-shm`), which is the `app_data` volume in Docker.

## Migrations
- `MIGRATIONS` is an append-only array of SQL strings; `PRAGMA user_version` stores how many ran.
- **Never edit an existing migration**. Add a new array entry (e.g. `ALTER TABLE ... ADD COLUMN ...`).
- Each migration runs in a transaction together with the `user_version` bump.

## Rules
- better-sqlite3 is **synchronous**. Keep queries small, index the columns you filter on (`jobs.status`, `job_items.job_id`, `job_items.day`).
- Multi-row writes go in `db.transaction(() => { ... })()`.
- Always use prepared statements with `?` parameters. For `LIKE`, escape `\ % _` and add `ESCAPE '\'`.
- Store times as epoch milliseconds (INTEGER). Store the local day (`YYYY-MM-DD` in `TZ`) on each attempt for the daily cap.
- Store lists (preset group ids) as JSON text; parse at the boundary.

## Queue semantics (job_items.status)
`pending → sending → sent | failed`, plus `cancelled`. Only `pending` is picked up.
On boot `recoverInterruptedItems()` turns `sending` into `failed` (unknown outcome → never auto-resend).
Daily usage = rows with `day = today AND status IN ('sent','failed','sending')`.

## Native module notes
- better-sqlite3 13 needs Node ≥ 22 (prebuilt binaries for Linux x64/arm64 and Windows). The Docker build
  stage has `python3 make g++` only as a fallback; they're not in the runtime image.

## Inspect / backup
```bash
docker compose exec app node -e "const D=require('better-sqlite3');const d=new D('/app/data/app.db',{readonly:true});console.table(d.prepare('select id,url,status from jobs order by id desc limit 10').all())"
# Backup: stop app, tar the app_data volume (see README "Backups").
```
