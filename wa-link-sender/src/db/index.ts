import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema>;

export interface Database_ {
  sqlite: Database.Database;
  db: Db;
  file: string;
  /** Migration tags applied during this start-up (empty when already up to date). */
  applied: string[];
}

const here = path.dirname(fileURLToPath(import.meta.url));
/** ./drizzle next to package.json (works for src/ via tsx and dist/ in Docker). */
export const MIGRATIONS_DIR = [path.join(here, '..', '..', 'drizzle'), path.join(process.cwd(), 'drizzle')].find((p) =>
  fs.existsSync(path.join(p, 'meta', '_journal.json')),
);

/** Fresh database file for the multi-user version (the single-key version used app.db). */
export const DB_FILENAME = 'app.sqlite';

export function openDatabase(dataDir: string, file = path.join(dataDir, DB_FILENAME)): Database_ {
  if (!MIGRATIONS_DIR) throw new Error('Database migrations folder (drizzle/) is missing from the build.');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle(sqlite, { schema });

  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8')) as {
    entries: { tag: string }[];
  };
  const before = countApplied(sqlite);
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  const after = countApplied(sqlite);
  const applied = journal.entries.slice(before, after).map((e) => e.tag);

  return { sqlite, db, file, applied };
}

function countApplied(sqlite: Database.Database): number {
  try {
    return (sqlite.prepare('SELECT COUNT(*) AS n FROM __drizzle_migrations').get() as { n: number }).n;
  } catch {
    return 0; // table not created yet
  }
}
