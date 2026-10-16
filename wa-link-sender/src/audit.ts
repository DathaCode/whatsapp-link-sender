import { and, count, desc, eq, gte, like, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import type { Db } from './db/index.js';
import { auditLog, type Outcome, type Role } from './db/schema.js';
import type { Logger } from './logger.js';

export interface Actor {
  userId: number | null;
  username: string; // a username, 'anonymous' or 'system'
  role: Role | null;
}

/** Who did it and from where. Built from the request (see http/context.ts) or SYSTEM. */
export interface AuditContext {
  actor: Actor;
  ip?: string | null;
  userAgent?: string | null;
  sessionId?: string | null;
}

export const SYSTEM: AuditContext = { actor: { userId: null, username: 'system', role: null } };
export const ANONYMOUS: Actor = { userId: null, username: 'anonymous', role: null };

export interface AuditEvent {
  action: string; // category.verb, e.g. "auth.login"
  outcome?: Outcome;
  targetType?: string;
  targetId?: string | number | null;
  reason?: string | null;
  details?: Record<string, unknown>;
  connectionId?: number | null;
}

export interface AuditFilters {
  from?: number;
  to?: number;
  userId?: number;
  category?: string;
  outcome?: Outcome;
  connectionId?: number;
  q?: string;
}

export type AuditRow = typeof auditLog.$inferSelect;

const SECRET_KEY = /pass(word)?|secret|token|hash|cookie|csrf|authorization/i;

/** Deep-copies `value`, replacing anything that looks like a secret. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[…]';
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SECRET_KEY.test(k) ? '[redacted]' : redact(v, depth + 1),
      ]),
    );
  }
  if (typeof value === 'string' && value.length > 2000) return value.slice(0, 2000) + '…';
  return value;
}

/** {field: {from, to}} for every field that changed. Secret fields are never included. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after)) {
    if (SECRET_KEY.test(key)) continue;
    const a = before[key];
    const b = after[key];
    if (JSON.stringify(a) !== JSON.stringify(b)) out[key] = { from: a, to: b };
  }
  return out;
}

export class AuditLog {
  constructor(
    private db: Db,
    private log: Logger,
  ) {}

  /** Appends one row. There is intentionally no update method. */
  record(ctx: AuditContext, ev: AuditEvent): number {
    const outcome = ev.outcome ?? 'success';
    const details = ev.details ? (redact(ev.details) as Record<string, unknown>) : undefined;
    const row = {
      ts: Date.now(),
      actorUserId: ctx.actor.userId,
      actorUsername: ctx.actor.username,
      actorRole: ctx.actor.role,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ? ctx.userAgent.slice(0, 300) : null,
      sessionId: ctx.sessionId ?? null,
      action: ev.action,
      category: ev.action.split('.')[0] ?? ev.action,
      targetType: ev.targetType ?? null,
      targetId: ev.targetId === undefined || ev.targetId === null ? null : String(ev.targetId),
      outcome,
      reason: ev.reason ? ev.reason.slice(0, 1000) : null,
      details: details ? JSON.stringify(details) : null,
      connectionId: ev.connectionId ?? null,
    };
    const inserted = this.db.insert(auditLog).values(row).returning({ id: auditLog.id }).get();
    // Mirror to the application log so `docker compose logs` shows it too.
    const level = outcome === 'success' ? 'info' : 'warn';
    this.log[level](
      { audit: { id: inserted.id, action: row.action, outcome, actor: row.actorUsername, target: row.targetType ? `${row.targetType}:${row.targetId}` : undefined, reason: row.reason ?? undefined } },
      `audit ${row.action} ${outcome}`,
    );
    return inserted.id;
  }

  private where(f: AuditFilters): SQL | undefined {
    const c: SQL[] = [];
    if (f.from !== undefined) c.push(gte(auditLog.ts, f.from));
    if (f.to !== undefined) c.push(lte(auditLog.ts, f.to));
    if (f.userId !== undefined) c.push(eq(auditLog.actorUserId, f.userId));
    if (f.category) c.push(eq(auditLog.category, f.category));
    if (f.outcome) c.push(eq(auditLog.outcome, f.outcome));
    if (f.connectionId !== undefined) c.push(eq(auditLog.connectionId, f.connectionId));
    if (f.q) {
      const q = `%${f.q.replace(/[\\%_]/g, (ch) => '\\' + ch)}%`;
      const l = (col: Parameters<typeof like>[0]) => sql`${col} LIKE ${q} ESCAPE '\\'`;
      c.push(
        or(
          l(auditLog.action),
          l(auditLog.actorUsername),
          l(auditLog.targetId),
          l(auditLog.reason),
          l(auditLog.details),
          l(auditLog.ip),
        )!,
      );
    }
    return c.length ? and(...c) : undefined;
  }

  query(f: AuditFilters, page: { limit: number; offset: number }): { rows: AuditRow[]; total: number } {
    const where = this.where(f);
    const rows = this.db
      .select()
      .from(auditLog)
      .where(where)
      .orderBy(desc(auditLog.id))
      .limit(page.limit)
      .offset(page.offset)
      .all();
    const total = this.db.select({ n: count() }).from(auditLog).where(where).get()?.n ?? 0;
    return { rows, total };
  }

  /** Streams matching rows newest-first in batches (for CSV export). */
  *iterate(f: AuditFilters, batch = 1000): Generator<AuditRow> {
    let beforeId: number | undefined;
    for (;;) {
      const base = this.where(f);
      const where = beforeId === undefined ? base : and(base, lt(auditLog.id, beforeId));
      const rows = this.db.select().from(auditLog).where(where).orderBy(desc(auditLog.id)).limit(batch).all();
      if (!rows.length) return;
      yield* rows;
      beforeId = rows[rows.length - 1]!.id;
    }
  }

  /** Retention: deletes rows older than `days` (DB trigger blocks anything younger than 30 days). */
  prune(days: number): number {
    const cutoff = Date.now() - days * 86_400_000;
    const removed = this.db.delete(auditLog).where(lt(auditLog.ts, cutoff)).run().changes;
    this.record(SYSTEM, {
      action: 'system.audit_pruned',
      details: { removed, retentionDays: days, cutoff: new Date(cutoff).toISOString() },
    });
    return removed;
  }
}

/** CSV with a header; all values quoted (protects against formula injection in spreadsheets). */
export function toCsvRow(values: unknown[]): string {
  return (
    values
      .map((v) => {
        let s = v === null || v === undefined ? '' : String(v);
        if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
        return '"' + s.replace(/"/g, '""') + '"';
      })
      .join(',') + '\r\n'
  );
}
