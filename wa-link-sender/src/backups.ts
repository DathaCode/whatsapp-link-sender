import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { AuditContext, AuditLog } from './audit.js';
import { notFound } from './errors.js';
import type { Logger } from './logger.js';

const NAME = /^app-\d{8}-\d{6}(-[a-z]+)?\.sqlite$/;

export interface BackupInfo {
  name: string;
  size: number;
  createdAt: number;
}

/** Consistent online copies of the database with `VACUUM INTO`, keeping the newest N. */
export class Backups {
  readonly dir: string;

  constructor(
    private sqlite: Database.Database,
    dataDir: string,
    private keep: number,
    private audit: AuditLog,
    private log: Logger,
  ) {
    this.dir = path.join(dataDir, 'backups');
  }

  list(): BackupInfo[] {
    if (!fs.existsSync(this.dir)) return [];
    return fs
      .readdirSync(this.dir)
      .filter((n) => NAME.test(n))
      .map((name) => {
        const st = fs.statSync(path.join(this.dir, name));
        return { name, size: st.size, createdAt: st.mtimeMs };
      })
      .sort((a, b) => b.name.localeCompare(a.name));
  }

  create(ctx: AuditContext, kind: 'nightly' | 'manual'): BackupInfo {
    fs.mkdirSync(this.dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const name = `app-${stamp}${kind === 'manual' ? '-manual' : ''}.sqlite`;
    const file = path.join(this.dir, name);
    try {
      fs.rmSync(file, { force: true });
      this.sqlite.prepare('VACUUM INTO ?').run(file);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      this.audit.record(ctx, { action: 'system.backup_created', outcome: 'failure', reason, details: { kind } });
      throw e;
    }
    const size = fs.statSync(file).size;
    const removed = this.prune();
    this.audit.record(ctx, { action: 'system.backup_created', targetType: 'backup', targetId: name, details: { kind, size, removedOld: removed } });
    this.log.info({ name, size }, 'backup created');
    return { name, size, createdAt: Date.now() };
  }

  /** Keeps the newest `keep` backups. */
  private prune(): string[] {
    const old = this.list().slice(this.keep);
    for (const b of old) fs.rmSync(path.join(this.dir, b.name), { force: true });
    return old.map((b) => b.name);
  }

  pathFor(name: string): string {
    if (!NAME.test(name)) throw notFound('That backup was not found.');
    const file = path.join(this.dir, name);
    if (!fs.existsSync(file)) throw notFound('That backup was not found.');
    return file;
  }
}
