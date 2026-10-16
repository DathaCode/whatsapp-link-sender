import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RouteDef } from '../src/http/app.js';
import { harness } from './helpers.js';

type H = Awaited<ReturnType<typeof harness>>;
let h: H;
beforeEach(async () => {
  h = await harness();
});
afterEach(async () => {
  await h.close();
});

const concrete = (r: RouteDef) => r.path.replace(/:id\b/g, '999').replace(/:name\b/g, 'app-20260101-000000.sqlite');
const call = (c: Awaited<ReturnType<H['admin']>>, r: RouteDef) => {
  const url = concrete(r);
  if (r.method === 'get') return c.get(url);
  if (r.method === 'post') return c.post(url, {});
  if (r.method === 'put') return c.put(url, {});
  return c.del(url);
};
const denied = () => h.actions().filter((a) => a.action === 'access.denied');

describe('role enforcement on every route', () => {
  it('the route table covers all access levels', () => {
    const levels = new Set(h.routes.map((r) => r.access));
    expect([...levels].sort()).toEqual(['admin', 'public', 'signed_in', 'user']);
    expect(h.routes.filter((r) => r.access === 'admin').length).toBeGreaterThan(25);
  });

  it('a USER gets 403 on every admin route, and each attempt is audit-logged', async () => {
    const admin = await h.admin();
    const { client: user } = await h.makeUser(admin, 'olivia');
    const adminRoutes = h.routes.filter((r) => r.access === 'admin');
    const before = denied().length;
    for (const r of adminRoutes) {
      const res = await call(user, r);
      expect(res.status, `${r.method.toUpperCase()} ${r.path}`).toBe(403);
      expect(res.body.code).toBe('admin_only');
    }
    const rows = denied().slice(before);
    expect(rows).toHaveLength(adminRoutes.length);
    for (const row of rows) {
      expect(row.actorUsername).toBe('olivia');
      expect(row.actorRole).toBe('USER');
      expect(row.outcome).toBe('denied');
      const details = JSON.parse(row.details!);
      expect(details.method).toBeTruthy();
      expect(details.route).toMatch(/^\/api\/admin\//);
    }
  });

  it('anonymous requests get 401 on every non-public route', async () => {
    const anon = h.client();
    for (const r of h.routes.filter((x) => x.access !== 'public')) {
      const res = await call(anon as never, r);
      expect(res.status, `${r.method.toUpperCase()} ${r.path}`).toBe(401);
    }
  });

  it('an ADMIN passes the guard on every admin route', async () => {
    const admin = await h.admin();
    for (const r of h.routes.filter((x) => x.access === 'admin')) {
      const res = await call(admin, r);
      expect([401, 403], `${r.method.toUpperCase()} ${r.path}`).not.toContain(res.status);
    }
  });

  it('before the forced password change only the password/auth routes work', async () => {
    const c = h.client();
    await c.login('admin', 'admin-initial-pw-123');
    expect((await c.get('/api/auth/me')).status).toBe(200);
    const res = await c.get('/api/send/options');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('password_change_required');
    const adminRes = await c.get('/api/admin/users');
    expect(adminRes.body.code).toBe('password_change_required');
  });

  it('state-changing requests need the CSRF token', async () => {
    const admin = await h.admin();
    const res = await admin.agent.post('/api/admin/presets').send({ name: 'x', groups: [] });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('csrf');
    expect(denied().at(-1)!.reason).toBe('csrf');
  });

  it('cross-site POSTs are refused', async () => {
    const admin = await h.admin();
    const res = await admin.agent.post('/api/admin/presets').set('origin', 'https://evil.example').set('x-csrf-token', admin.csrf).send({});
    expect(res.status).toBe(403);
    expect(denied().at(-1)!.reason).toBe('cross_site_request');
  });

  it('a USER only sees their own send history', async () => {
    const admin = await h.admin();
    await h.linkConnection(admin);
    const p = await admin.post('/api/admin/presets', { name: 'P', groups: [{ id: '111@g.us', name: 'Alpha group' }] });
    const a = await h.makeUser(admin, 'anna', [p.body.preset.id]);
    const b = await h.makeUser(admin, 'ben', [p.body.preset.id]);
    const sent = await a.client.post('/api/jobs', { url: 'https://youtu.be/abc', groupIds: ['111@g.us'], presetIds: [p.body.preset.id] });
    expect(sent.status).toBe(201);
    const jobId = sent.body.job.id;

    expect((await b.client.get('/api/jobs')).body.jobs).toHaveLength(0);
    const peek = await b.client.get(`/api/jobs/${jobId}`);
    expect(peek.status).toBe(403);
    expect((await b.client.post(`/api/jobs/${jobId}/cancel`)).status).toBe(403);
    expect((await a.client.get('/api/jobs')).body.jobs).toHaveLength(1);
    expect((await admin.get('/api/jobs')).body.jobs).toHaveLength(1);
  });
});
