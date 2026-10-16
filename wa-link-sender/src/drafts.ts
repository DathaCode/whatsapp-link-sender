import { eq } from 'drizzle-orm';
import type { Db } from './db/index.js';
import { drafts } from './db/schema.js';

export interface Draft {
  text: string;
  uploadId: string | null;
  updatedAt: number | null;
}

/** One autosaved message draft per user (server-side, so a refresh or another device keeps it). */
export class Drafts {
  constructor(private db: Db) {}

  get(userId: number): Draft {
    const r = this.db.select().from(drafts).where(eq(drafts.userId, userId)).get();
    return r ? { text: r.text, uploadId: r.uploadId, updatedAt: r.updatedAt } : { text: '', uploadId: null, updatedAt: null };
  }

  save(userId: number, d: { text: string; uploadId: string | null }) {
    const now = Date.now();
    this.db
      .insert(drafts)
      .values({ userId, text: d.text, uploadId: d.uploadId, updatedAt: now })
      .onConflictDoUpdate({ target: drafts.userId, set: { text: d.text, uploadId: d.uploadId, updatedAt: now } })
      .run();
    return { ...d, updatedAt: now };
  }

  clear(userId: number) {
    this.db.delete(drafts).where(eq(drafts.userId, userId)).run();
  }
}
