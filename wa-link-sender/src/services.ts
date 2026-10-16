import { AuditLog, SYSTEM } from './audit.js';
import { SessionStore } from './auth/sessions.js';
import { Backups } from './backups.js';
import { Catalog } from './catalog.js';
import { Composer } from './compose.js';
import { Drafts } from './drafts.js';
import { Images } from './images.js';
import type { Config } from './config.js';
import { ConnectionManager, type RuntimeFactory } from './connections.js';
import { openDatabase } from './db/index.js';
import { EventHub } from './events.js';
import { JobStore } from './jobs.js';
import type { Logger } from './logger.js';
import { SendQueue } from './queue.js';
import { Settings } from './settings.js';
import { UserService } from './users.js';
import { WaClient } from './whatsapp.js';

/** Builds every service. Used by the server, the CLI and the tests (with a fake WhatsApp runtime). */
export function createServices(cfg: Config, log: Logger, opts: { runtimeFactory?: RuntimeFactory; dbFile?: string } = {}) {
  const database = opts.dbFile ? openDatabase(cfg.DATA_DIR, opts.dbFile) : openDatabase(cfg.DATA_DIR);
  const { db, sqlite } = database;
  const audit = new AuditLog(db, log.child({ mod: 'audit' }));
  if (database.applied.length) {
    audit.record(SYSTEM, { action: 'system.migrations_run', details: { applied: database.applied, file: database.file } });
  }
  const hub = new EventHub();
  const sessions = new SessionStore(db, cfg);
  const users = new UserService(db, audit, sessions, cfg);
  const catalog = new Catalog(db, audit);
  const settings = new Settings(cfg, db, audit);
  const jobs = new JobStore(db);
  const images = new Images(db, cfg.DATA_DIR, audit);
  const drafts = new Drafts(db);
  const composer = new Composer(settings, catalog, images, jobs);
  const runtimeFactory: RuntimeFactory =
    opts.runtimeFactory ?? ((clientId) => new WaClient(clientId, cfg, log.child({ mod: 'whatsapp' })));
  const connections = new ConnectionManager(db, audit, cfg, log.child({ mod: 'connections' }), runtimeFactory);

  // Live updates: admins see everything; users see their own jobs and a phone-less sending status.
  const userSending = () => {
    const s = connections.sendingStatus();
    return s.connection ? { ...s, connection: { ...s.connection, phone: null } } : s;
  };
  const queue = new SendQueue(
    cfg,
    jobs,
    connections,
    images,
    settings,
    audit,
    log.child({ mod: 'queue' }),
    (job) => {
      hub.adminsAnd(job.userId, 'job', job);
      hub.all('usage', queue.usage());
    },
    (status) => hub.all('queue', status),
  );
  const backups = new Backups(sqlite, cfg.DATA_DIR, cfg.BACKUP_KEEP, audit, log.child({ mod: 'backup' }));

  connections.on('changed', () => hub.admins('connections', connections.list()));
  connections.on('sending', () => {
    hub.admins('sending', connections.sendingStatus());
    hub.all('sending_user', userSending());
    queue.kick();
  });

  return { database, db, sqlite, audit, hub, sessions, users, catalog, composer, images, drafts, settings, jobs, connections, queue, backups };
}

export type Services = ReturnType<typeof createServices>;
