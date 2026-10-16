import { eq, isNotNull } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { auditLog, sendResults, sessions } from '../src/db/schema.js';
import type { SafetySettings } from '../src/settings.js';
import { harness, tick, waitFor } from './helpers.js';

type H = Awaited<ReturnType<typeof harness>>;
let h: H;
beforeEach(async () => {
  h = await harness();
});
afterEach(async () => {
  await h.close();
});

/** Every event type the spec requires, by action name. */
const REQUIRED = [
  // auth
  'auth.login', 'auth.lockout', 'auth.logout', 'auth.session_expired', 'auth.password_changed', 'auth.password_reset', 'auth.forced_signout',
  // access
  'access.denied',
  // users
  'user.created', 'user.updated', 'user.role_changed', 'user.disabled', 'user.enabled',
  // connections
  'connection.added', 'connection.qr_generated', 'connection.linked', 'connection.disconnected', 'connection.logged_out',
  'connection.suspected_ban', 'connection.activated', 'connection.removed', 'connection.reconnect_attempt', 'connection.reconnect_failed',
  // groups & presets
  'group.refreshed', 'preset.created', 'preset.updated', 'preset.deleted', 'preset.access_changed',
  // settings
  'settings.updated',
  // sending
  'send.requested', 'send.blocked', 'send.duplicate_confirmed', 'send.job_started', 'send.job_completed', 'send.job_cancelled', 'send.result',
  // system
  'system.migrations_run', 'system.backup_created', 'system.backup_downloaded', 'system.audit_exported', 'system.audit_pruned',
];

const runtimeFor = (clientId: string) => h.world.runtimes.filter((r) => r.clientId === clientId).at(-1)!;
const clientIdOf = (id: number) => h.svc.connections.list().find((c) => c.id === id)!.clientId;

describe('audit log coverage', () => {
  it('writes audit rows for each listed action', async () => {
    // ---- auth ----
    const admin = await h.admin();
    await h.client().login('admin', 'wrong-password-1');
    for (let i = 0; i < 5; i++) await h.client().login('ghost', 'whatever-1234');

    // ---- connections, groups ----
    const c1 = await h.linkConnection(admin, 'Number one', '94770000001');
    await admin.post('/api/admin/groups/refresh');

    // ---- presets ----
    const p = (await admin.post('/api/admin/presets', { name: 'All', groups: [{ id: '111@g.us', name: 'Alpha group' }, { id: '222@g.us', name: 'Beta group' }] })).body.preset;
    await admin.put(`/api/admin/presets/${p.id}`, { name: 'All partners', groups: [{ id: '111@g.us', name: 'Alpha group' }, { id: '222@g.us', name: 'Beta group' }, { id: '333@g.us', name: 'Gamma group' }] });
    const tmp = (await admin.post('/api/admin/presets', { name: 'Temp', groups: [] })).body.preset;
    await admin.del(`/api/admin/presets/${tmp.id}`);

    // ---- users ----
    const u = await h.makeUser(admin, 'ursula', [p.id]);
    const other = await h.makeUser(admin, 'oscar');
    await admin.put(`/api/admin/users/${other.id}`, { displayName: 'Oscar O.' });
    await admin.put(`/api/admin/users/${other.id}`, { role: 'ADMIN' });
    await admin.put(`/api/admin/users/${other.id}`, { role: 'USER' });
    await admin.post(`/api/admin/users/${other.id}/disable`);
    await admin.post(`/api/admin/users/${other.id}/enable`);
    await admin.post(`/api/admin/users/${other.id}/reset-password`);
    await admin.post(`/api/admin/users/${u.id}/sign-out`);
    await u.client.login('ursula', u.password);
    await u.client.get('/api/admin/users'); // denied
    const expiring = await h.makeUser(admin, 'eve');
    h.svc.db.update(sessions).set({ lastSeenAt: 1 }).where(eq(sessions.userId, expiring.id)).run();
    await expiring.client.get('/api/auth/me'); // session expired

    // ---- settings (before stubbing them for fast sending) ----
    await admin.put('/api/admin/settings', { dailyCap: 100 });
    const safety: SafetySettings = { minDelaySeconds: 0, maxDelaySeconds: 0, imageMinDelaySeconds: 0, imageMaxDelaySeconds: 0, imageSendMode: 'single', dailyCap: 100, windowStart: '00:00', windowEnd: '23:59' };
    h.svc.settings.get = () => safety;
    h.svc.queue.start();

    // ---- sending ----
    await u.client.post('/api/jobs', { text: '   ', groupIds: ['111@g.us'], presetIds: [p.id] }); // empty_message
    await u.client.post('/api/jobs', { text: 'New post 👉 https://youtu.be/x', groupIds: ['333@g.us'], presetIds: [] }); // no_permission? (333 is in preset now)
    h.world.failFor.add('222@g.us');
    const ok = await u.client.post('/api/jobs', { text: 'New post 👉 https://youtu.be/first', groupIds: ['111@g.us', '222@g.us'], presetIds: [p.id] });
    expect(ok.status).toBe(201);
    await waitFor(() => h.svc.jobs.get(ok.body.job.id)!.status === 'done');
    const dup = await u.client.post('/api/jobs', { text: 'New post 👉 https://youtu.be/first', groupIds: ['111@g.us'], presetIds: [p.id] });
    expect(dup.status).toBe(409);
    const confirmed = await u.client.post('/api/jobs', { text: 'New post 👉 https://youtu.be/first', groupIds: ['111@g.us'], presetIds: [p.id], confirmDuplicate: true });
    expect(confirmed.status).toBe(201);
    await waitFor(() => h.svc.jobs.get(confirmed.body.job.id)!.status === 'done');

    // outside hours → waits → cancel
    safety.windowStart = '00:00';
    safety.windowEnd = '00:01';
    const later = await u.client.post('/api/jobs', { text: 'New post 👉 https://youtu.be/later', groupIds: ['111@g.us'], presetIds: [p.id] });
    h.svc.queue.kick();
    await waitFor(() => h.svc.jobs.get(later.body.job.id)!.status === 'waiting');
    await u.client.post(`/api/jobs/${later.body.job.id}/cancel`);
    // daily cap → waits
    safety.windowEnd = '23:59';
    safety.dailyCap = 1;
    const capped = await admin.post('/api/jobs', { text: 'New post 👉 https://youtu.be/cap', groupIds: ['111@g.us'] });
    h.svc.queue.kick();
    await waitFor(() => h.svc.jobs.get(capped.body.job.id)!.waitReason === 'daily_cap');
    await admin.post(`/api/jobs/${capped.body.job.id}/cancel`);

    // ---- more connection events ----
    const rt1 = runtimeFor(clientIdOf(c1));
    rt1.emit('disconnected', 'NAVIGATION');
    rt1.emit('reconnect', { attempt: 1, delayMs: 5000, reason: 'Disconnected (NAVIGATION)' });
    rt1.emit('start_failed', 'browser crashed');
    rt1.becomeReady();
    // second number: links into standby, then becomes active
    const c2res = await admin.post('/api/admin/connections', { label: 'Number two' });
    await tick();
    h.world.latest().scan('94770000002');
    await tick();
    const c2 = c2res.body.connection.id as number;
    expect(h.svc.connections.list().find((c) => c.id === c2)!.status).toBe('standby');
    await admin.post(`/api/admin/connections/${c2}/activate`);
    await tick();
    // the active number gets logged out → sending paused → a user's send is blocked
    runtimeFor(clientIdOf(c2)).emit('logged_out', { reason: 'WhatsApp logged this number out (LOGOUT)', suspectedBan: false });
    const paused = await u.client.post('/api/jobs', { text: 'New post 👉 https://youtu.be/paused', groupIds: ['111@g.us'], presetIds: [p.id] });
    expect(paused.status).toBe(503);
    expect(paused.body.error).toMatch(/contact your admin/);
    // admin switches back to number one, which then reports a ban
    await admin.post(`/api/admin/connections/${c1}/activate`);
    await tick();
    runtimeFor(clientIdOf(c1)).emit('logged_out', { reason: 'WhatsApp reported TOS_BLOCK', suspectedBan: true });
    await admin.del(`/api/admin/connections/${c2}`);

    // ---- system ----
    const backup = await admin.post('/api/admin/backups');
    expect(backup.status).toBe(201);
    const dl = await admin.get(`/api/admin/backups/${backup.body.backup.name}/download`);
    expect(dl.status).toBe(200);
    const csv = await admin.get('/api/admin/audit/export?category=auth');
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain('auth.lockout');
    h.svc.audit.prune(365);

    await admin.post('/api/auth/logout');

    // ---- check ----
    const seen = new Set(h.actions().map((r) => r.action));
    const missing = REQUIRED.filter((a) => !seen.has(a));
    expect(missing).toEqual([]);

    const blockedReasons = new Set(h.actions().filter((r) => r.action === 'send.blocked').map((r) => r.reason));
    for (const reason of ['empty_message', 'duplicate', 'outside_hours', 'daily_cap', 'connection_down']) {
      expect(blockedReasons, reason).toContain(reason);
    }

    // Every finished per-group result links back to its audit row.
    const results = h.svc.db.select().from(sendResults).where(isNotNull(sendResults.auditId)).all();
    expect(results.length).toBeGreaterThanOrEqual(3);
    for (const r of results) {
      const a = h.svc.db.select().from(auditLog).where(eq(auditLog.id, r.auditId!)).get()!;
      expect(a.action).toBe('send.result');
      expect(JSON.parse(a.details!).jobId).toBe(r.jobId);
      expect(a.outcome).toBe(r.status === 'sent' ? 'success' : 'failure');
    }

    // Rows carry who/where.
    const login = h.actions().find((r) => r.action === 'auth.login' && r.outcome === 'success')!;
    expect(login.actorUsername).toBe('admin');
    expect(login.ip).toBeTruthy();
    expect(login.sessionId).toBeTruthy();
    expect(login.userAgent).toBeDefined();
    const change = h.actions().find((r) => r.action === 'settings.updated')!;
    expect(JSON.parse(change.details!).changes.dailyCap).toEqual({ from: 150, to: 100 });
  }, 20_000);
});

describe('audit log is append-only', () => {
  it('rejects updates and deletes of recent rows at the database level', () => {
    const row = h.actions()[0]!;
    expect(() => h.svc.sqlite.prepare('UPDATE audit_log SET reason = ? WHERE id = ?').run('tampered', row.id)).toThrow(/append-only/);
    expect(() => h.svc.sqlite.prepare('DELETE FROM audit_log WHERE id = ?').run(row.id)).toThrow(/cannot be deleted/);
  });

  it('retention pruning removes only old rows and logs how many', () => {
    const old = Date.now() - 400 * 86_400_000;
    h.svc.sqlite
      .prepare(`INSERT INTO audit_log (ts, actor_username, action, category, outcome) VALUES (?, 'system', 'system.test', 'system', 'success')`)
      .run(old);
    const before = h.actions().length;
    expect(h.svc.audit.prune(365)).toBe(1);
    const pruned = h.actions().filter((r) => r.action === 'system.audit_pruned').at(-1)!;
    expect(JSON.parse(pruned.details!).removed).toBe(1);
    expect(h.actions().length).toBe(before); // one removed, one "pruned" row added
  });

  it('never stores secrets in details', async () => {
    const admin = await h.admin();
    await admin.post('/api/admin/users', { username: 'pat', role: 'USER', password: 'super-secret-pass-1' });
    expect(h.actions().some((r) => (r.details ?? '').includes('super-secret-pass-1'))).toBe(false);
  });
});
