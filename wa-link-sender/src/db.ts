import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { Platform } from './urls.js';

export type JobStatus = 'queued' | 'running' | 'waiting' | 'done' | 'cancelled';
export type WaitReason = 'whatsapp_offline' | 'outside_hours' | 'daily_cap' | null;
export type ItemStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'cancelled';

export interface Group {
  id: string;
  name: string;
  readOnly: boolean;
}
export interface Preset {
  id: number;
  name: string;
  groupIds: string[];
}
export interface Template {
  id: number;
  name: string;
  body: string;
  active: boolean;
}
export interface JobItem {
  id: number;
  jobId: number;
  groupId: string;
  groupName: string;
  status: ItemStatus;
  error: string | null;
  attemptedAt: number | null;
}
export interface Job {
  id: number;
  url: string;
  platform: Platform;
  templateId: number | null;
  status: JobStatus;
  waitReason: WaitReason;
  parentJobId: number | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  total: number;
  sent: number;
  failed: number;
  pending: number;
}
export interface JobWithItems extends Job {
  items: JobItem[];
}

const MIGRATIONS: string[] = [
  `
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    key_fp TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    read_only INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE presets (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    group_ids TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE templates (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    body TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE jobs (
    id INTEGER PRIMARY KEY,
    url TEXT NOT NULL,
    platform TEXT NOT NULL,
    template_id INTEGER,
    status TEXT NOT NULL,
    wait_reason TEXT,
    parent_job_id INTEGER REFERENCES jobs(id),
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    finished_at INTEGER
  );
  CREATE INDEX jobs_url ON jobs(url);
  CREATE INDEX jobs_status ON jobs(status);
  CREATE TABLE job_items (
    id INTEGER PRIMARY KEY,
    job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    group_id TEXT NOT NULL,
    group_name TEXT NOT NULL,
    status TEXT NOT NULL,
    message TEXT,
    error TEXT,
    attempted_at INTEGER,
    day TEXT
  );
  CREATE INDEX job_items_job ON job_items(job_id);
  CREATE INDEX job_items_day ON job_items(day);
  `,
];

const DEFAULT_TEMPLATES: { name: string; body: string }[] = [
  { name: 'Just the link', body: '{url}' },
  { name: 'New post', body: 'New post is up 👇\n{url}' },
  { name: 'Please watch & share', body: 'Please watch and share 🙏\n{url}' },
  { name: 'Check this out', body: 'Check this out: {url}' },
];

interface JobRow {
  id: number;
  url: string;
  platform: Platform;
  template_id: number | null;
  status: JobStatus;
  wait_reason: WaitReason;
  parent_job_id: number | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  total: number;
  sent: number;
  failed: number;
  pending: number;
}

const JOB_SELECT = `
  SELECT j.*,
    (SELECT COUNT(*) FROM job_items i WHERE i.job_id = j.id) AS total,
    (SELECT COUNT(*) FROM job_items i WHERE i.job_id = j.id AND i.status = 'sent') AS sent,
    (SELECT COUNT(*) FROM job_items i WHERE i.job_id = j.id AND i.status = 'failed') AS failed,
    (SELECT COUNT(*) FROM job_items i WHERE i.job_id = j.id AND i.status IN ('pending','sending')) AS pending
  FROM jobs j`;

const toJob = (r: JobRow): Job => ({
  id: r.id,
  url: r.url,
  platform: r.platform,
  templateId: r.template_id,
  status: r.status,
  waitReason: r.wait_reason,
  parentJobId: r.parent_job_id,
  createdAt: r.created_at,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  total: r.total,
  sent: r.sent,
  failed: r.failed,
  pending: r.pending,
});

interface ItemRow {
  id: number;
  job_id: number;
  group_id: string;
  group_name: string;
  status: ItemStatus;
  error: string | null;
  attempted_at: number | null;
}
const toItem = (r: ItemRow): JobItem => ({
  id: r.id,
  jobId: r.job_id,
  groupId: r.group_id,
  groupName: r.group_name,
  status: r.status,
  error: r.error,
  attemptedAt: r.attempted_at,
});

export class Store {
  readonly db: Database.Database;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = new Database(path.join(dataDir, 'app.db'));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.migrate();
  }

  private migrate() {
    const version = this.db.pragma('user_version', { simple: true }) as number;
    for (let v = version; v < MIGRATIONS.length; v++) {
      this.db.transaction(() => {
        this.db.exec(MIGRATIONS[v]!);
        this.db.pragma(`user_version = ${v + 1}`);
      })();
    }
    const count = this.db.prepare('SELECT COUNT(*) AS n FROM templates').get() as { n: number };
    if (count.n === 0 && version === 0) {
      const ins = this.db.prepare('INSERT INTO templates (name, body, active, updated_at) VALUES (?, ?, 1, ?)');
      for (const t of DEFAULT_TEMPLATES) ins.run(t.name, t.body, Date.now());
    }
  }

  close() {
    this.db.close();
  }

  // ---------- settings ----------
  getSetting<T>(key: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : undefined;
  }
  setSetting(key: string, value: unknown) {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value));
  }

  // ---------- sessions ----------
  createSession(tokenHash: string, keyFp: string, ttlMs: number) {
    const now = Date.now();
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
    this.db
      .prepare('INSERT INTO sessions (token_hash, key_fp, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(tokenHash, keyFp, now, now + ttlMs);
  }
  findSession(tokenHash: string): { keyFp: string; expiresAt: number } | undefined {
    const row = this.db.prepare('SELECT key_fp, expires_at FROM sessions WHERE token_hash = ?').get(tokenHash) as
      | { key_fp: string; expires_at: number }
      | undefined;
    return row ? { keyFp: row.key_fp, expiresAt: row.expires_at } : undefined;
  }
  deleteSession(tokenHash: string) {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }

  // ---------- groups ----------
  listGroups(): Group[] {
    return (
      this.db.prepare('SELECT id, name, read_only FROM groups ORDER BY name COLLATE NOCASE').all() as {
        id: string;
        name: string;
        read_only: number;
      }[]
    ).map((g) => ({ id: g.id, name: g.name, readOnly: !!g.read_only }));
  }
  replaceGroups(groups: Group[]) {
    const now = Date.now();
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM groups').run();
      const ins = this.db.prepare('INSERT INTO groups (id, name, read_only, updated_at) VALUES (?, ?, ?, ?)');
      for (const g of groups) ins.run(g.id, g.name, g.readOnly ? 1 : 0, now);
    })();
  }
  groupNames(ids: string[]): Map<string, string> {
    const map = new Map<string, string>();
    const stmt = this.db.prepare('SELECT name FROM groups WHERE id = ?');
    for (const id of ids) {
      const row = stmt.get(id) as { name: string } | undefined;
      if (row) map.set(id, row.name);
    }
    return map;
  }

  // ---------- presets ----------
  listPresets(): Preset[] {
    return (
      this.db.prepare('SELECT id, name, group_ids FROM presets ORDER BY name COLLATE NOCASE').all() as {
        id: number;
        name: string;
        group_ids: string;
      }[]
    ).map((p) => ({ id: p.id, name: p.name, groupIds: JSON.parse(p.group_ids) as string[] }));
  }
  upsertPreset(p: { id?: number; name: string; groupIds: string[] }): number {
    const now = Date.now();
    if (p.id) {
      const r = this.db
        .prepare('UPDATE presets SET name = ?, group_ids = ?, updated_at = ? WHERE id = ?')
        .run(p.name, JSON.stringify(p.groupIds), now, p.id);
      if (r.changes === 0) throw new NotFoundError('That group list no longer exists.');
      return p.id;
    }
    return Number(
      this.db
        .prepare('INSERT INTO presets (name, group_ids, updated_at) VALUES (?, ?, ?)')
        .run(p.name, JSON.stringify(p.groupIds), now).lastInsertRowid,
    );
  }
  deletePreset(id: number) {
    this.db.prepare('DELETE FROM presets WHERE id = ?').run(id);
  }

  // ---------- templates ----------
  listTemplates(): Template[] {
    return (
      this.db.prepare('SELECT id, name, body, active FROM templates ORDER BY id').all() as {
        id: number;
        name: string;
        body: string;
        active: number;
      }[]
    ).map((t) => ({ id: t.id, name: t.name, body: t.body, active: !!t.active }));
  }
  getTemplate(id: number): Template | undefined {
    return this.listTemplates().find((t) => t.id === id);
  }
  upsertTemplate(t: { id?: number; name: string; body: string; active: boolean }): number {
    const now = Date.now();
    if (t.id) {
      const r = this.db
        .prepare('UPDATE templates SET name = ?, body = ?, active = ?, updated_at = ? WHERE id = ?')
        .run(t.name, t.body, t.active ? 1 : 0, now, t.id);
      if (r.changes === 0) throw new NotFoundError('That message template no longer exists.');
      return t.id;
    }
    return Number(
      this.db
        .prepare('INSERT INTO templates (name, body, active, updated_at) VALUES (?, ?, ?, ?)')
        .run(t.name, t.body, t.active ? 1 : 0, now).lastInsertRowid,
    );
  }
  deleteTemplate(id: number) {
    this.db.prepare('DELETE FROM templates WHERE id = ?').run(id);
  }

  // ---------- jobs ----------
  createJob(input: {
    url: string;
    platform: Platform;
    templateId: number | null;
    parentJobId: number | null;
    groups: { id: string; name: string }[];
  }): number {
    return this.db.transaction(() => {
      const jobId = Number(
        this.db
          .prepare(
            `INSERT INTO jobs (url, platform, template_id, status, parent_job_id, created_at)
             VALUES (?, ?, ?, 'queued', ?, ?)`,
          )
          .run(input.url, input.platform, input.templateId, input.parentJobId, Date.now()).lastInsertRowid,
      );
      const ins = this.db.prepare(
        `INSERT INTO job_items (job_id, group_id, group_name, status) VALUES (?, ?, ?, 'pending')`,
      );
      for (const g of input.groups) ins.run(jobId, g.id, g.name);
      return jobId;
    })();
  }

  getJob(id: number): JobWithItems | undefined {
    const row = this.db.prepare(`${JOB_SELECT} WHERE j.id = ?`).get(id) as JobRow | undefined;
    if (!row) return undefined;
    const items = (this.db.prepare('SELECT * FROM job_items WHERE job_id = ? ORDER BY id').all(id) as ItemRow[]).map(
      toItem,
    );
    return { ...toJob(row), items };
  }

  listJobs(opts: { search?: string; limit: number; offset: number }): Job[] {
    const where = opts.search ? `WHERE j.url LIKE ? ESCAPE '\\'` : '';
    const params: unknown[] = opts.search ? [`%${opts.search.replace(/[\\%_]/g, (c) => '\\' + c)}%`] : [];
    return (
      this.db
        .prepare(`${JOB_SELECT} ${where} ORDER BY j.id DESC LIMIT ? OFFSET ?`)
        .all(...params, opts.limit, opts.offset) as JobRow[]
    ).map(toJob);
  }

  /** Jobs that still have work to do, oldest first. */
  activeJobs(): Job[] {
    return (
      this.db
        .prepare(`${JOB_SELECT} WHERE j.status IN ('queued','running','waiting') ORDER BY j.id`)
        .all() as JobRow[]
    ).map(toJob);
  }

  lastSendOfUrl(url: string): { jobId: number; at: number; groups: number } | undefined {
    const row = this.db
      .prepare(
        `SELECT j.id, j.created_at,
           (SELECT COUNT(*) FROM job_items i WHERE i.job_id = j.id AND i.status = 'sent') AS sent
         FROM jobs j WHERE j.url = ? AND j.status != 'cancelled' ORDER BY j.id DESC LIMIT 1`,
      )
      .get(url) as { id: number; created_at: number; sent: number } | undefined;
    return row ? { jobId: row.id, at: row.created_at, groups: row.sent } : undefined;
  }

  setJobStatus(id: number, status: JobStatus, waitReason: WaitReason = null) {
    const now = Date.now();
    this.db
      .prepare(
        `UPDATE jobs SET status = ?, wait_reason = ?,
           started_at = CASE WHEN ? = 'running' AND started_at IS NULL THEN ? ELSE started_at END,
           finished_at = CASE WHEN ? IN ('done','cancelled') THEN ? ELSE finished_at END
         WHERE id = ?`,
      )
      .run(status, waitReason, status, now, status, now, id);
  }

  nextPendingItem(jobId: number): JobItem | undefined {
    const row = this.db
      .prepare(`SELECT * FROM job_items WHERE job_id = ? AND status = 'pending' ORDER BY id LIMIT 1`)
      .get(jobId) as ItemRow | undefined;
    return row ? toItem(row) : undefined;
  }

  markItemSending(id: number, message: string, day: string) {
    this.db
      .prepare(`UPDATE job_items SET status = 'sending', message = ?, attempted_at = ?, day = ?, error = NULL WHERE id = ?`)
      .run(message, Date.now(), day, id);
  }
  finishItem(id: number, status: 'sent' | 'failed' | 'pending' | 'cancelled', error: string | null = null) {
    this.db.prepare('UPDATE job_items SET status = ?, error = ? WHERE id = ?').run(status, error, id);
  }
  cancelPendingItems(jobId: number) {
    this.db
      .prepare(`UPDATE job_items SET status = 'cancelled' WHERE job_id = ? AND status = 'pending'`)
      .run(jobId);
  }

  /**
   * After a crash or restart we cannot know whether an in-flight message went out,
   * so we mark it failed rather than risk a double post.
   */
  recoverInterruptedItems(): number {
    return this.db
      .prepare(
        `UPDATE job_items SET status = 'failed',
           error = 'The app restarted while sending. Check the group, then use “Retry failed” if needed.'
         WHERE status = 'sending'`,
      )
      .run().changes;
  }

  failedItems(jobId: number): { id: string; name: string }[] {
    return (
      this.db
        .prepare(`SELECT group_id, group_name FROM job_items WHERE job_id = ? AND status = 'failed' ORDER BY id`)
        .all(jobId) as { group_id: string; group_name: string }[]
    ).map((r) => ({ id: r.group_id, name: r.group_name }));
  }

  /** Messages attempted on a given local day (sent, failed and in-flight all count against the cap). */
  usageOn(day: string): number {
    return (
      this.db
        .prepare(`SELECT COUNT(*) AS n FROM job_items WHERE day = ? AND status IN ('sent','failed','sending')`)
        .get(day) as { n: number }
    ).n;
  }
}

export class NotFoundError extends Error {}
