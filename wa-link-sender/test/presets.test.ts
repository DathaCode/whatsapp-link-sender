import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { harness } from './helpers.js';

type H = Awaited<ReturnType<typeof harness>>;
let h: H;
beforeEach(async () => {
  h = await harness();
});
afterEach(async () => {
  await h.close();
});

async function setup() {
  const admin = await h.admin();
  await h.linkConnection(admin);
  const p1 = (await admin.post('/api/admin/presets', { name: 'Sinhala groups', groups: [{ id: '111@g.us', name: 'Alpha group' }, { id: '222@g.us', name: 'Beta group' }] })).body.preset;
  const p2 = (await admin.post('/api/admin/presets', { name: 'Partners', groups: [{ id: '333@g.us', name: 'Gamma group' }] })).body.preset;
  const user = await h.makeUser(admin, 'uma', [p1.id]);
  return { admin, user, p1, p2 };
}

const denials = () => h.actions().filter((r) => r.action === 'send.blocked' && r.outcome === 'denied');

describe('preset permissions', () => {
  it('a user only sees their assigned presets and their groups', async () => {
    const { user, p1 } = await setup();
    const opts = (await user.client.get('/api/send/options')).body;
    expect(opts.isAdmin).toBe(false);
    expect(opts.presets.map((p: { id: number }) => p.id)).toEqual([p1.id]);
    expect(opts.groups.map((g: { id: string }) => g.id).sort()).toEqual(['111@g.us', '222@g.us']);
    expect(opts.sending.connection.phone).toBeNull();
  });

  it('allows groups inside an assigned preset (and unticking some)', async () => {
    const { user, p1 } = await setup();
    const r = await user.client.post('/api/jobs', { text: 'New post 👉 https://youtu.be/ok1', groupIds: ['111@g.us'], presetIds: [p1.id] });
    expect(r.status).toBe(201);
    expect(r.body.job.total).toBe(1);
  });

  it('refuses a group outside the user’s presets, and logs it', async () => {
    const { user, p1 } = await setup();
    const r = await user.client.post('/api/jobs', { text: 'New post 👉 https://youtu.be/no1', groupIds: ['111@g.us', '333@g.us'], presetIds: [p1.id] });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('no_permission');
    expect(denials()).toHaveLength(1);
    expect(denials()[0]!.reason).toBe('no_permission');
    expect(h.actions().some((x) => x.action === 'access.denied' && x.reason === 'no_permission')).toBe(true);
  });

  it('refuses a preset that isn’t assigned, even with allowed groups', async () => {
    const { user, p2 } = await setup();
    const r = await user.client.post('/api/jobs', { text: 'New post 👉 https://youtu.be/no2', groupIds: ['111@g.us'], presetIds: [p2.id] });
    expect(r.status).toBe(403);
  });

  it('access changes take effect immediately and are audited', async () => {
    const { admin, user, p2 } = await setup();
    await admin.put(`/api/admin/users/${user.id}/presets`, { presetIds: [p2.id] });
    const r = await user.client.post('/api/jobs', { text: 'New post 👉 https://youtu.be/ok2', groupIds: ['333@g.us'], presetIds: [p2.id] });
    expect(r.status).toBe(201);
    const old = await user.client.post('/api/jobs', { text: 'New post 👉 https://youtu.be/no3', groupIds: ['111@g.us'], presetIds: [] });
    expect(old.status).toBe(403);
    const row = h.actions().filter((x) => x.action === 'preset.access_changed').at(-1)!;
    expect(JSON.parse(row.details!)).toMatchObject({ to: [p2.id] });
  });

  it('admins may send to any group on the active number', async () => {
    const { admin } = await setup();
    const r = await admin.post('/api/jobs', { text: 'New post 👉 https://youtu.be/adm', groupIds: ['333@g.us', '222@g.us'] });
    expect(r.status).toBe(201);
  });

  it('read-only groups and groups the number isn’t in are refused', async () => {
    const { admin } = await setup();
    expect((await admin.post('/api/jobs', { text: 'New post 👉 https://youtu.be/ro', groupIds: ['444@g.us'] })).status).toBe(400);
    expect((await admin.post('/api/jobs', { text: 'New post 👉 https://youtu.be/ro2', groupIds: ['999@g.us'] })).status).toBe(400);
  });
});
