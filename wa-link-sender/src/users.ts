import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import { diff, type AuditContext, type AuditLog, SYSTEM } from './audit.js';
import { burnVerify, checkPasswordPolicy, hashPassword, temporaryPassword, verifyPassword } from './auth/passwords.js';
import type { SessionStore, SessionUser } from './auth/sessions.js';
import type { Config } from './config.js';
import type { Db } from './db/index.js';
import { loginThrottle, presetAccess, presets, ROLES, users, type Role } from './db/schema.js';
import { AppError, badRequest, conflict, notFound } from './errors.js';

export interface UserView {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  disabled: boolean;
  mustChangePassword: boolean;
  lastLoginAt: number | null;
  createdAt: number;
  presetIds: number[];
  activeSessions: number;
}

const USERNAME = /^[a-zA-Z0-9._-]{3,32}$/;
export const GENERIC_LOGIN_ERROR = 'Wrong username or password.';

export function lockedMessage(minutes: number) {
  return `Too many failed sign-in attempts. Wait ${minutes} minute${minutes === 1 ? '' : 's'}, then try again.`;
}

export class UserService {
  constructor(
    private db: Db,
    private audit: AuditLog,
    private sessions: SessionStore,
    private cfg: Config,
  ) {}

  private find(id: number) {
    return this.db.select().from(users).where(eq(users.id, id)).get();
  }
  private findByName(username: string) {
    return this.db
      .select()
      .from(users)
      .where(sql`lower(${users.username}) = ${username.toLowerCase()}`)
      .get();
  }
  private require(id: number) {
    const u = this.find(id);
    if (!u) throw notFound('That user was not found.');
    return u;
  }

  count(): number {
    return this.db.select({ n: count() }).from(users).get()?.n ?? 0;
  }

  private activeAdminCount(): number {
    return (
      this.db
        .select({ n: count() })
        .from(users)
        .where(and(eq(users.role, 'ADMIN'), eq(users.disabled, false)))
        .get()?.n ?? 0
    );
  }

  /** First boot: create the admin from .env. Returns false when users already exist. */
  async ensureInitialAdmin(): Promise<boolean> {
    if (this.count() > 0) return false;
    const { INITIAL_ADMIN_USERNAME: username, INITIAL_ADMIN_PASSWORD: password } = this.cfg;
    if (!username || !password) {
      throw new AppError(
        500,
        'No users exist yet. Set INITIAL_ADMIN_USERNAME and INITIAL_ADMIN_PASSWORD in .env to create the first admin, then start again.',
        'no_initial_admin',
      );
    }
    checkPasswordPolicy(password);
    const now = Date.now();
    const created = this.db
      .insert(users)
      .values({
        username,
        displayName: username,
        role: 'ADMIN',
        passwordHash: await hashPassword(password),
        mustChangePassword: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: users.id })
      .get();
    this.audit.record(SYSTEM, {
      action: 'user.created',
      targetType: 'user',
      targetId: created.id,
      details: { username, role: 'ADMIN', source: 'INITIAL_ADMIN_* in .env', mustChangePassword: true },
    });
    return true;
  }

  // ---------------- sign-in ----------------

  async login(
    usernameRaw: unknown,
    password: unknown,
    meta: { ip: string | null; userAgent: string | null },
  ): Promise<{ token: string; sessionId: string; user: SessionUser }> {
    const username = typeof usernameRaw === 'string' ? usernameRaw.trim().slice(0, 64) : '';
    const pw = typeof password === 'string' ? password.slice(0, 1024) : '';
    const key = username.toLowerCase();
    const anonCtx: AuditContext = { actor: { userId: null, username: 'anonymous', role: null }, ...meta };
    const now = Date.now();

    const throttle = key ? this.db.select().from(loginThrottle).where(eq(loginThrottle.username, key)).get() : undefined;
    if (throttle?.lockedUntil && throttle.lockedUntil > now) {
      this.audit.record(anonCtx, {
        action: 'auth.login',
        outcome: 'failure',
        reason: 'account_locked',
        details: { attemptedUsername: username, lockedUntil: new Date(throttle.lockedUntil).toISOString() },
      });
      throw new AppError(429, lockedMessage(Math.ceil((throttle.lockedUntil - now) / 60_000)), 'locked');
    }

    const user = key ? this.findByName(key) : undefined;
    let ok = false;
    let reason = 'unknown_user';
    if (user) {
      ok = await verifyPassword(user.passwordHash, pw);
      reason = ok ? '' : 'wrong_password';
      if (ok && user.disabled) {
        ok = false;
        reason = 'user_disabled';
      }
    } else {
      await burnVerify(pw);
    }

    if (!ok) {
      const failures = (throttle?.failures ?? 0) + 1;
      const lock = failures >= this.cfg.LOGIN_MAX_ATTEMPTS;
      const lockedUntil = lock ? now + this.cfg.LOGIN_LOCK_MINUTES * 60_000 : null;
      if (key) {
        this.db
          .insert(loginThrottle)
          .values({ username: key, failures: lock ? 0 : failures, lockedUntil, updatedAt: now })
          .onConflictDoUpdate({
            target: loginThrottle.username,
            set: { failures: lock ? 0 : failures, lockedUntil, updatedAt: now },
          })
          .run();
      }
      const ctx: AuditContext = user
        ? { actor: { userId: user.id, username: user.username, role: user.role }, ...meta }
        : anonCtx;
      this.audit.record(ctx, {
        action: 'auth.login',
        outcome: 'failure',
        reason,
        targetType: user ? 'user' : undefined,
        targetId: user?.id,
        details: { attemptedUsername: username, failedAttempts: failures },
      });
      if (lock) {
        this.audit.record(ctx, {
          action: 'auth.lockout',
          outcome: 'failure',
          reason: `${failures} failed attempts`,
          targetType: user ? 'user' : undefined,
          targetId: user?.id,
          details: { attemptedUsername: username, lockMinutes: this.cfg.LOGIN_LOCK_MINUTES },
        });
        throw new AppError(429, lockedMessage(this.cfg.LOGIN_LOCK_MINUTES), 'locked');
      }
      throw new AppError(401, GENERIC_LOGIN_ERROR, 'bad_credentials');
    }

    // Success
    this.db.delete(loginThrottle).where(eq(loginThrottle.username, key)).run();
    this.db.update(users).set({ lastLoginAt: now }).where(eq(users.id, user!.id)).run();
    const { token, sessionId } = this.sessions.create(user!.id, meta);
    const sessionUser: SessionUser = {
      id: user!.id,
      username: user!.username,
      displayName: user!.displayName,
      role: user!.role,
      mustChangePassword: user!.mustChangePassword,
    };
    this.audit.record(
      { actor: { userId: user!.id, username: user!.username, role: user!.role }, ...meta, sessionId },
      { action: 'auth.login', targetType: 'user', targetId: user!.id, details: { mustChangePassword: user!.mustChangePassword } },
    );
    return { token, sessionId, user: sessionUser };
  }

  async changeOwnPassword(ctx: AuditContext, current: unknown, next: unknown) {
    const id = ctx.actor.userId!;
    const u = this.require(id);
    if (typeof current !== 'string' || !(await verifyPassword(u.passwordHash, current))) {
      this.audit.record(ctx, { action: 'auth.password_changed', outcome: 'failure', reason: 'wrong_current_password', targetType: 'user', targetId: id });
      throw badRequest('Your current password is not right.', 'wrong_current_password');
    }
    const pw = checkPasswordPolicy(next);
    if (await verifyPassword(u.passwordHash, pw)) {
      this.audit.record(ctx, { action: 'auth.password_changed', outcome: 'failure', reason: 'password_reused', targetType: 'user', targetId: id });
      throw badRequest('Choose a password that is different from your current one.', 'password_reused');
    }
    const now = Date.now();
    this.db
      .update(users)
      .set({ passwordHash: await hashPassword(pw), mustChangePassword: false, passwordChangedAt: now, updatedAt: now })
      .where(eq(users.id, id))
      .run();
    const ended = this.sessions.revokeAllForUser(id, 'password_changed', ctx.sessionId ?? undefined);
    this.audit.record(ctx, { action: 'auth.password_changed', targetType: 'user', targetId: id, details: { otherSessionsEnded: ended } });
  }

  // ---------------- admin: user management ----------------

  list(): UserView[] {
    const access = this.db.select().from(presetAccess).all();
    return this.db
      .select()
      .from(users)
      .orderBy(asc(users.username))
      .all()
      .map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        role: u.role,
        disabled: u.disabled,
        mustChangePassword: u.mustChangePassword,
        lastLoginAt: u.lastLoginAt,
        createdAt: u.createdAt,
        presetIds: access.filter((a) => a.userId === u.id).map((a) => a.presetId),
        activeSessions: this.sessions.activeSessionCount(u.id),
      }));
  }

  view(id: number): UserView {
    const v = this.list().find((u) => u.id === id);
    if (!v) throw notFound('That user was not found.');
    return v;
  }

  async create(
    ctx: AuditContext,
    input: { username: string; displayName: string; role: Role; password?: string },
  ): Promise<{ user: UserView; temporaryPassword: string | null }> {
    if (!USERNAME.test(input.username)) {
      throw badRequest('Usernames are 3-32 letters, digits, dots, dashes or underscores.', 'bad_username');
    }
    if (!ROLES.includes(input.role)) throw badRequest('Choose a role.');
    if (this.findByName(input.username)) {
      this.audit.record(ctx, { action: 'user.created', outcome: 'failure', reason: 'username_taken', details: { username: input.username } });
      throw conflict('That username is already taken. Pick another one.', 'username_taken');
    }
    const temp = input.password ? null : temporaryPassword();
    const pw = input.password ? checkPasswordPolicy(input.password) : temp!;
    const now = Date.now();
    const created = this.db
      .insert(users)
      .values({
        username: input.username,
        displayName: input.displayName.trim() || input.username,
        role: input.role,
        passwordHash: await hashPassword(pw),
        mustChangePassword: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: users.id })
      .get();
    this.audit.record(ctx, {
      action: 'user.created',
      targetType: 'user',
      targetId: created.id,
      details: { username: input.username, displayName: input.displayName, role: input.role, mustChangePassword: true },
    });
    return { user: this.view(created.id), temporaryPassword: temp };
  }

  private guardLastAdmin(ctx: AuditContext, target: typeof users.$inferSelect, action: string, what: string) {
    if (target.role === 'ADMIN' && !target.disabled && this.activeAdminCount() <= 1) {
      this.audit.record(ctx, { action, outcome: 'failure', reason: 'last_active_admin', targetType: 'user', targetId: target.id, details: { attempted: what } });
      throw conflict(
        `${target.username} is the last active admin. Make another user an admin first, so someone can still manage the app.`,
        'last_admin',
      );
    }
  }

  update(ctx: AuditContext, id: number, patch: { displayName?: string; role?: Role }): UserView {
    const u = this.require(id);
    const next = {
      displayName: patch.displayName?.trim() || u.displayName,
      role: patch.role ?? u.role,
    };
    if (u.role === 'ADMIN' && next.role !== 'ADMIN') this.guardLastAdmin(ctx, u, 'user.role_changed', 'demote');
    const changes = diff({ displayName: u.displayName, role: u.role }, next);
    if (!Object.keys(changes).length) return this.view(id);
    this.db
      .update(users)
      .set({ ...next, updatedAt: Date.now() })
      .where(eq(users.id, id))
      .run();
    this.audit.record(ctx, { action: 'user.updated', targetType: 'user', targetId: id, details: { username: u.username, changes } });
    if (changes.role) {
      this.audit.record(ctx, {
        action: 'user.role_changed',
        targetType: 'user',
        targetId: id,
        details: { username: u.username, from: u.role, to: next.role },
      });
      // New role, new permissions: make them sign in again.
      this.sessions.revokeAllForUser(id, 'role_changed');
    }
    return this.view(id);
  }

  setDisabled(ctx: AuditContext, id: number, disabled: boolean): UserView {
    const u = this.require(id);
    if (u.disabled === disabled) return this.view(id);
    if (disabled) this.guardLastAdmin(ctx, u, 'user.disabled', 'disable');
    this.db.update(users).set({ disabled, updatedAt: Date.now() }).where(eq(users.id, id)).run();
    const ended = disabled ? this.sessions.revokeAllForUser(id, 'user_disabled') : 0;
    this.audit.record(ctx, {
      action: disabled ? 'user.disabled' : 'user.enabled',
      targetType: 'user',
      targetId: id,
      details: { username: u.username, sessionsEnded: ended },
    });
    return this.view(id);
  }

  async resetPassword(ctx: AuditContext, id: number, source: 'admin' | 'cli' = 'admin'): Promise<string> {
    const u = this.require(id);
    const temp = temporaryPassword();
    const now = Date.now();
    this.db
      .update(users)
      .set({ passwordHash: await hashPassword(temp), mustChangePassword: true, passwordChangedAt: now, updatedAt: now })
      .where(eq(users.id, id))
      .run();
    this.db.delete(loginThrottle).where(eq(loginThrottle.username, u.username.toLowerCase())).run();
    const ended = this.sessions.revokeAllForUser(id, 'password_reset');
    this.audit.record(ctx, {
      action: 'auth.password_reset',
      targetType: 'user',
      targetId: id,
      details: { username: u.username, source, sessionsEnded: ended, mustChangePassword: true },
    });
    return temp;
  }

  forceSignOut(ctx: AuditContext, id: number): number {
    const u = this.require(id);
    const ended = this.sessions.revokeAllForUser(id, 'forced_signout');
    this.audit.record(ctx, { action: 'auth.forced_signout', targetType: 'user', targetId: id, details: { username: u.username, sessionsEnded: ended } });
    return ended;
  }

  presetIdsFor(userId: number): number[] {
    return this.db
      .select({ id: presetAccess.presetId })
      .from(presetAccess)
      .where(eq(presetAccess.userId, userId))
      .all()
      .map((r) => r.id);
  }

  setPresetAccess(ctx: AuditContext, userId: number, presetIds: number[]): UserView {
    const u = this.require(userId);
    const ids = [...new Set(presetIds)].sort((a, b) => a - b);
    const existing = ids.length ? this.db.select({ id: presets.id }).from(presets).where(inArray(presets.id, ids)).all() : [];
    if (existing.length !== ids.length) throw badRequest('One of those presets no longer exists. Reload the page.');
    const before = this.presetIdsFor(userId).sort((a, b) => a - b);
    if (JSON.stringify(before) === JSON.stringify(ids)) return this.view(userId);
    this.db.transaction((tx) => {
      tx.delete(presetAccess).where(eq(presetAccess.userId, userId)).run();
      if (ids.length) tx.insert(presetAccess).values(ids.map((presetId) => ({ userId, presetId }))).run();
    });
    this.audit.record(ctx, {
      action: 'preset.access_changed',
      targetType: 'user',
      targetId: userId,
      details: { username: u.username, from: before, to: ids },
    });
    return this.view(userId);
  }

  /** CLI helper: picks the admin account to recover. */
  findAdminForRecovery(username?: string) {
    if (username) return this.findByName(username);
    if (this.cfg.INITIAL_ADMIN_USERNAME) {
      const u = this.findByName(this.cfg.INITIAL_ADMIN_USERNAME);
      if (u) return u;
    }
    return this.db.select().from(users).where(eq(users.role, 'ADMIN')).orderBy(asc(users.id)).get();
  }

  /** CLI: re-enable, unlock and make sure the account is an admin. */
  restoreAdmin(ctx: AuditContext, id: number) {
    const u = this.require(id);
    const before = { role: u.role, disabled: u.disabled };
    this.db.update(users).set({ role: 'ADMIN', disabled: false, updatedAt: Date.now() }).where(eq(users.id, id)).run();
    const changes = diff(before, { role: 'ADMIN' as Role, disabled: false });
    if (Object.keys(changes).length) {
      this.audit.record(ctx, { action: 'user.updated', targetType: 'user', targetId: id, details: { username: u.username, changes, source: 'cli' } });
    }
  }
}
