import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { SYSTEM } from './audit.js';
import { parseConfig } from './config.js';
import { AppError } from './errors.js';
import { createApp } from './http/app.js';
import { logger } from './logger.js';
import { Scheduler } from './scheduler.js';
import { createServices } from './services.js';

dotenv.config({ quiet: true });

const parsed = parseConfig(process.env);
if (!parsed.ok) {
  // Plain text on purpose: this is read by a person fixing their .env file.
  console.error('\nwa-link-sender cannot start because of these settings problems:\n');
  for (const e of parsed.errors) console.error(`  • ${e}`);
  console.error('\nFix them in your .env file (see .env.example), then start again.\n');
  process.exit(1);
}
const cfg = parsed.config;
process.env.TZ = cfg.TZ;
logger.level = cfg.LOG_LEVEL;
const log = logger;
if (process.env.ACCESS_KEY) log.warn('ACCESS_KEY is no longer used: sign-in now uses user accounts. You can remove it from .env.');

// Image sends need the whatsapp-web.js media fix (applied at install time by scripts/patch-whatsapp-web.cjs).
try {
  const require_ = createRequire(import.meta.url);
  const utils = path.join(path.dirname(require_.resolve('whatsapp-web.js/package.json')), 'src', 'util', 'Injected', 'Utils.js');
  if (!fs.readFileSync(utils, 'utf8').includes('delete message.__x_id')) {
    log.error('whatsapp-web.js is missing the media-send fix: image posts will fail. Reinstall dependencies (npm ci) so scripts/patch-whatsapp-web.cjs runs.');
  }
} catch {
  /* best effort */
}

// whatsapp-web.js occasionally rejects promises from its own page listeners.
// Log them instead of letting Node kill the whole server.
process.on('unhandledRejection', (reason) => {
  log.error({ err: reason instanceof Error ? reason.stack : String(reason) }, 'unhandled promise rejection');
});

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir =
  [path.join(here, '..', 'public'), path.join(here, '..', 'web', 'dist')].find((p) => fs.existsSync(path.join(p, 'index.html'))) ??
  path.join(here, '..', 'public');

const svc = createServices(cfg, log);
const { audit, users, connections, queue, catalog, hub, backups } = svc;

try {
  await users.ensureInitialAdmin();
} catch (e) {
  console.error(`\n${e instanceof AppError ? e.message : String(e)}\n`);
  process.exit(1);
}
catalog.seedSnippets();
svc.jobs.backfillMainLinks();

// Right after connecting, WhatsApp Web may not have synced chats yet: retry a few times.
let groupLoadRun = 0;
connections.on('active_ready', async () => {
  queue.kick();
  const run = ++groupLoadRun;
  for (const waitMs of [0, 10_000, 30_000, 90_000]) {
    if (waitMs) await new Promise((r) => setTimeout(r, waitMs));
    if (run !== groupLoadRun || !connections.isReady()) return;
    try {
      const groups = await connections.refreshGroups(SYSTEM);
      hub.admins('groups', groups);
      if (groups.length > 0) return;
    } catch (e) {
      log.warn({ err: e instanceof Error ? e.message : String(e) }, 'could not load groups yet');
    }
  }
});

const { app } = createApp({ cfg, log, publicDir, ...svc });
const server = app.listen(cfg.PORT, () => {
  log.info({ port: cfg.PORT, tz: cfg.TZ, dataDir: cfg.DATA_DIR, db: svc.database.file }, `wa-link-sender listening on http://localhost:${cfg.PORT}`);
});
server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') console.error(`\nPort ${cfg.PORT} is already in use. Set a different PORT in .env, then start again.\n`);
  else log.fatal({ err: e.message }, 'web server error');
  process.exit(1);
});

const version = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8')).version as string;
audit.record(SYSTEM, { action: 'system.started', details: { version, node: process.version, port: cfg.PORT, tz: cfg.TZ } });

connections.boot();
queue.start();
const scheduler = new Scheduler(cfg, svc.db, backups, audit, svc.images, log.child({ mod: 'scheduler' }));
scheduler.start();

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, 'shutting down');
  const force = setTimeout(() => {
    log.error('shutdown took too long; exiting');
    process.exit(1);
  }, 25_000);
  force.unref();

  scheduler.stop();
  server.close();
  hub.close();
  await queue.stop(); // let an in-flight message finish
  await connections.stopAll(); // close Chromium cleanly so sessions are saved
  audit.record(SYSTEM, { action: 'system.stopped', details: { signal } });
  svc.sqlite.close();
  log.info('bye');
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
