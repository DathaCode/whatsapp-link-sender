import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loginThrottle, sessions, users } from '../src/db/schema.js';
import { ADMIN, harness } from './helpers.js';

type H = Awaited<ReturnType<typeof harness>>;
let h: H;
beforeEach(async () => {
  h = await harness();
});
afterEach(async () => {
  await h.close();
});

const has = (action: string, pred: (r: ReturnType<H['actions']>[number]) => boolean = () => true) =>
  h.actions().some((r) => r.action === action && pred(r));

describe('first boot & passwords', () => {
  it('creates the initial admin with a forced password change', async () => {
    const c = h.client();
    const r = await c.login(ADMIN.username, ADMIN.password);
    expect(r.status).toBe(200);
    expect(r.body.user.role).toBe('ADMIN');
    expect(r.body.user.mustChangePassword).toBe(true);
    expect(JSON.stringify(r.body)).not.toMatch(/argon2|passwordHash/);
    expect(has('user.created', (x) => x.actorUsername === 'system')).toBe(true);
  });

  it('enforces length and blocks reusing the current password', async () => {
    const c = h.client();
    await c.login(ADMIN.username, ADMIN.password);
    const short = await c.post('/api/auth/change-password', { currentPassword: ADMIN.password, newPassword: 'short' });
    expect(short.status).toBe(400);
    const same = await c.post('/api/auth/change-password', { currentPassword: ADMIN.password, newPassword: ADMIN.password });
    expect(same.status).toBe(400);
    expect(same.body.code).toBe('password_reused');
    const ok = await c.post('/api/auth/change-password', { currentPassword: ADMIN.password, newPassword: 'a-brand-new-pass' });
    expect(ok.status).toBe(200);
    expect(ok.body.user.mustChangePassword).toBe(false);
    expect(has('auth.password_changed', (r) => r.outcome === 'success')).toBe(true);
    expect(has('auth.password_changed', (r) => r.reason === 'password_reused')).toBe(true);
  });

  it('stores argon2id hashes and never logs them', async () => {
    const row = h.svc.db.select().from(users).get()!;
    expect(row.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(h.actions().some((a) => (a.details ?? '').includes('$argon2'))).toBe(false);
  });
});

describe('login lockout', () => {
  it('locks after 5 failures for 15 minutes, even with the right password', async () => {
    const c = h.client();
    for (let i = 1; i <= 4; i++) {
      const r = await c.login(ADMIN.username, 'wrong-password');
      expect(r.status).toBe(401);
      expect(r.body.error).toBe('Wrong username or password.');
    }
    const fifth = await c.login(ADMIN.username, 'wrong-password');
    expect(fifth.status).toBe(429);
    expect(fifth.body.code).toBe('locked');
    expect(has('auth.lockout')).toBe(true);

    const right = await c.login(ADMIN.username, ADMIN.password);
    expect(right.status).toBe(429);
    expect(has('auth.login', (r) => r.reason === 'account_locked')).toBe(true);

    // After the lock expires, the right password works again.
    h.svc.db.update(loginThrottle).set({ lockedUntil: Date.now() - 1000 }).run();
    expect((await c.login(ADMIN.username, ADMIN.password)).status).toBe(200);
  });

  it('gives the same answer for unknown usernames (no user enumeration)', async () => {
    const c = h.client();
    const unknown = await c.login('nobody-here', 'whatever-123');
    const wrong = await c.login(ADMIN.username, 'whatever-123');
    expect(unknown.status).toBe(wrong.status);
    expect(unknown.body).toEqual(wrong.body);
    const row = h.actions().find((r) => r.action === 'auth.login' && r.reason === 'unknown_user')!;
    expect(JSON.parse(row.details!).attemptedUsername).toBe('nobody-here');
    expect(row.actorUsername).toBe('anonymous');
  });

  it('unknown usernames get locked too', async () => {
    const c = h.client();
    for (let i = 0; i < 4; i++) await c.login('ghost', 'x-password-1');
    expect((await c.login('ghost', 'x-password-1')).status).toBe(429);
  });

  it('respects LOGIN_MAX_ATTEMPTS', async () => {
    await h.close();
    h = await harness({ LOGIN_MAX_ATTEMPTS: '2' });
    const c = h.client();
    expect((await c.login(ADMIN.username, 'nope-nope-1')).status).toBe(401);
    expect((await c.login(ADMIN.username, 'nope-nope-1')).status).toBe(429);
  });
});

describe('sessions', () => {
  it('logs out and the cookie stops working', async () => {
    const admin = await h.admin();
    expect((await admin.post('/api/auth/logout')).status).toBe(200);
    expect((await admin.get('/api/auth/me')).status).toBe(401);
    expect(has('auth.logout')).toBe(true);
  });

  it('expires after the idle timeout and records it', async () => {
    const admin = await h.admin();
    h.svc.db.update(sessions).set({ lastSeenAt: Date.now() - 9 * 3_600_000 }).run();
    const r = await admin.get('/api/auth/me');
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('session_expired');
    expect(has('auth.session_expired', (x) => x.reason === 'idle_timeout')).toBe(true);
  });

  it('expires at the absolute timeout even when active', async () => {
    const admin = await h.admin();
    h.svc.db.update(sessions).set({ expiresAt: Date.now() - 1 }).run();
    expect((await admin.get('/api/auth/me')).status).toBe(401);
    expect(has('auth.session_expired', (x) => x.reason === 'absolute_timeout')).toBe(true);
  });

  it('forced sign-out ends all of a user’s sessions', async () => {
    const admin = await h.admin();
    const u = await h.makeUser(admin, 'sam');
    expect((await admin.post(`/api/admin/users/${u.id}/sign-out`)).body.sessionsEnded).toBeGreaterThan(0);
    expect((await u.client.get('/api/auth/me')).status).toBe(401);
    expect(has('auth.forced_signout')).toBe(true);
  });

  it('admin password reset forces a change and signs the user out', async () => {
    const admin = await h.admin();
    const u = await h.makeUser(admin, 'rita');
    const r = await admin.post(`/api/admin/users/${u.id}/reset-password`);
    expect(r.body.temporaryPassword).toMatch(/^\w{4}-\w{4}-\w{4}-\w{4}$/);
    expect((await u.client.get('/api/auth/me')).status).toBe(401);
    const again = h.client();
    const login = await again.login('rita', r.body.temporaryPassword);
    expect(login.body.user.mustChangePassword).toBe(true);
    const row = h.actions().find((x) => x.action === 'auth.password_reset')!;
    expect(row.details).not.toContain(r.body.temporaryPassword);
  });

  it('disabled users cannot sign in, and their sessions end', async () => {
    const admin = await h.admin();
    const u = await h.makeUser(admin, 'dan');
    await admin.post(`/api/admin/users/${u.id}/disable`);
    expect((await u.client.get('/api/auth/me')).status).toBe(401);
    const c = h.client();
    expect((await c.login('dan', u.password)).status).toBe(401);
    expect(has('auth.login', (r) => r.reason === 'user_disabled')).toBe(true);
    await admin.post(`/api/admin/users/${u.id}/enable`);
    expect((await c.login('dan', u.password)).status).toBe(200);
  });
});

describe('last-admin protection', () => {
  it('cannot demote or disable the last active admin', async () => {
    const admin = await h.admin();
    const id = h.svc.db.select().from(users).where(eq(users.username, 'admin')).get()!.id;
    const demote = await admin.put(`/api/admin/users/${id}`, { role: 'USER' });
    expect(demote.status).toBe(409);
    expect(demote.body.code).toBe('last_admin');
    const disable = await admin.post(`/api/admin/users/${id}/disable`);
    expect(disable.status).toBe(409);
    expect(h.actions().filter((r) => r.reason === 'last_active_admin')).toHaveLength(2);
  });

  it('works once another admin exists', async () => {
    const admin = await h.admin();
    const second = await admin.post('/api/admin/users', { username: 'boss2', displayName: 'Boss 2', role: 'ADMIN' });
    expect(second.status).toBe(201);
    const id = h.svc.db.select().from(users).where(eq(users.username, 'admin')).get()!.id;
    const demote = await admin.put(`/api/admin/users/${id}`, { role: 'USER' });
    expect(demote.status).toBe(200);
    expect(has('user.role_changed')).toBe(true);
    // boss2 is now the only active admin: can't be disabled.
    const boss = await h.client().login('boss2', second.body.temporaryPassword);
    expect(boss.status).toBe(200);
    expect(h.svc.users.list().filter((u) => u.role === 'ADMIN' && !u.disabled)).toHaveLength(1);
  });
});
