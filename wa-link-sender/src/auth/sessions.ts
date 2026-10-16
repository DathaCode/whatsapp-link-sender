import crypto from 'node:crypto';
import { and, eq, isNull, lt } from 'drizzle-orm';
import type { Config } from '../config.js';
import type { Db } from '../db/index.js';
import { sessions, users, type Role } from '../db/schema.js';

export const SESSION_COOKIE = 'wls_sid';
export const CSRF_HEADER = 'x-csrf-token';

const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

export interface SessionUser {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  mustChangePassword: boolean;
}

export type SessionLookup =
  | { ok: true; sessionId: string; user: SessionUser; csrf: string }
  | { ok: false; reason: 'none' | 'idle_timeout' | 'absolute_timeout' | 'revoked' | 'disabled'; sessionId?: string; user?: SessionUser };

/** Server-side sessions with idle + absolute timeouts and a per-session CSRF token. */
export class SessionStore {
  private idleMs: number;
  private maxMs: number;

  constructor(
    private db: Db,
    private cfg: Config,
  ) {
    this.idleMs = cfg.SESSION_IDLE_HOURS * 3_600_000;
    this.maxMs = cfg.SESSION_MAX_DAYS * 86_400_000;
  }

  get maxAgeMs() {
    return this.maxMs;
  }

  /** CSRF token = HMAC(SESSION_SECRET, session id). Nothing extra to store; rotates with the session. */
  csrfFor(sessionId: string): string {
    return crypto.createHmac('sha256', this.cfg.SESSION_SECRET).update(`csrf:${sessionId}`).digest('base64url');
  }

  checkCsrf(sessionId: string, provided: unknown): boolean {
    if (typeof provided !== 'string' || provided.length > 200) return false;
    const a = Buffer.from(this.csrfFor(sessionId));
    const b = Buffer.from(provided);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  create(userId: number, meta: { ip: string | null; userAgent: string | null }): { token: string; sessionId: string } {
    const token = crypto.randomBytes(32).toString('base64url');
    const sessionId = crypto.randomUUID();
    const now = Date.now();
    this.db
      .insert(sessions)
      .values({
        id: sessionId,
        tokenHash: sha256(token),
        userId,
        createdAt: now,
        lastSeenAt: now,
        expiresAt: now + this.maxMs,
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 300) ?? null,
      })
      .run();
    // Housekeeping: forget sessions that ended more than 30 days ago.
    this.db
      .delete(sessions)
      .where(lt(sessions.expiresAt, now - 30 * 86_400_000))
      .run();
    return { token, sessionId };
  }

  lookup(token: unknown): SessionLookup {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return { ok: false, reason: 'none' };
    const row = this.db
      .select({ s: sessions, u: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.tokenHash, sha256(token)))
      .get();
    if (!row) return { ok: false, reason: 'none' };
    const user: SessionUser = {
      id: row.u.id,
      username: row.u.username,
      displayName: row.u.displayName,
      role: row.u.role,
      mustChangePassword: row.u.mustChangePassword,
    };
    const base = { sessionId: row.s.id, user };
    if (row.s.revokedAt) return { ok: false, reason: 'revoked', ...base };
    const now = Date.now();
    if (row.u.disabled) {
      this.revoke(row.s.id, 'user_disabled');
      return { ok: false, reason: 'disabled', ...base };
    }
    if (now > row.s.expiresAt) {
      this.revoke(row.s.id, 'absolute_timeout');
      return { ok: false, reason: 'absolute_timeout', ...base };
    }
    if (now - row.s.lastSeenAt > this.idleMs) {
      this.revoke(row.s.id, 'idle_timeout');
      return { ok: false, reason: 'idle_timeout', ...base };
    }
    // Avoid a write on every request: refresh "last seen" at most once a minute.
    if (now - row.s.lastSeenAt > 60_000) {
      this.db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.s.id)).run();
    }
    return { ok: true, ...base, csrf: this.csrfFor(row.s.id) };
  }

  revoke(sessionId: string, reason: string) {
    this.db
      .update(sessions)
      .set({ revokedAt: Date.now(), revokeReason: reason })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)))
      .run();
  }

  /** Signs a user out everywhere (optionally keeping one session). Returns how many were ended. */
  revokeAllForUser(userId: number, reason: string, exceptSessionId?: string): number {
    const live = this.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
      .all()
      .filter((s) => s.id !== exceptSessionId);
    for (const s of live) this.revoke(s.id, reason);
    return live.length;
  }

  activeSessionCount(userId: number): number {
    const now = Date.now();
    return this.db
      .select({ id: sessions.id, lastSeenAt: sessions.lastSeenAt, expiresAt: sessions.expiresAt })
      .from(sessions)
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
      .all()
      .filter((s) => s.expiresAt > now && now - s.lastSeenAt <= this.idleMs).length;
  }
}
