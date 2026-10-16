import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createApp } from './app.js';
import { parseConfig } from './config.js';
import { Store } from './db.js';
import { EventHub } from './events.js';
import { logger } from './logger.js';
import { SendQueue } from './queue.js';
import { Settings } from './settings.js';
import { WhatsApp } from './whatsapp.js';

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

// whatsapp-web.js occasionally rejects promises from its own page listeners.
// Log them instead of letting Node kill the whole server (the original crash).
process.on('unhandledRejection', (reason) => {
  log.error({ err: reason instanceof Error ? reason.stack : String(reason) }, 'unhandled promise rejection');
});

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = [path.join(here, '..', 'public'), path.join(here, '..', 'web', 'dist')].find((p) =>
  fs.existsSync(path.join(p, 'index.html')),
);
if (!publicDir) log.warn('web page files not found; build them with "npm run build:web"');

const store = new Store(cfg.DATA_DIR);
const hub = new EventHub();
const settings = new Settings(cfg, store);
const wa = new WhatsApp(cfg, log.child({ mod: 'whatsapp' }));
const queue = new SendQueue(cfg, store, wa, settings, hub, log.child({ mod: 'queue' }));

wa.on('status', (s) => hub.emit('whatsapp', s));
// Right after linking, WhatsApp Web may not have synced chats yet, so retry a few times
// until groups show up (or give up quietly; "Refresh groups" is always available).
let groupLoadRun = 0;
wa.on('ready', async () => {
  queue.kick();
  const run = ++groupLoadRun;
  for (const waitMs of [0, 10_000, 30_000, 90_000]) {
    if (waitMs) await new Promise((r) => setTimeout(r, waitMs));
    if (run !== groupLoadRun || !wa.isReady()) return;
    try {
      const groups = await wa.listGroups();
      store.replaceGroups(groups);
      hub.emit('groups', groups);
      log.info({ count: groups.length }, 'groups loaded');
      if (groups.length > 0) return;
    } catch (e) {
      log.warn({ err: e instanceof Error ? e.message : String(e) }, 'could not load groups yet');
    }
  }
});

const app = createApp({ cfg, store, wa, queue, settings, hub, log, publicDir: publicDir ?? path.join(here, '..', 'public') });
const server = app.listen(cfg.PORT, () => {
  log.info(
    { port: cfg.PORT, tz: cfg.TZ, dataDir: cfg.DATA_DIR, safety: settings.get() },
    `wa-link-sender listening on http://localhost:${cfg.PORT}`,
  );
});
server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\nPort ${cfg.PORT} is already in use. Set a different PORT in .env, then start again.\n`);
  } else {
    log.fatal({ err: e.message }, 'web server error');
  }
  process.exit(1);
});

wa.start();
queue.start();

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

  server.close();
  hub.close();
  await queue.stop(); // let an in-flight message finish
  await wa.stop(); // close Chromium cleanly so the session is saved
  store.close();
  log.info('bye');
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
