import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SafetySettings } from '../src/settings.js';
import { harness, waitFor } from './helpers.js';

type H = Awaited<ReturnType<typeof harness>>;
let h: H;
let safety: SafetySettings;
let admin: Awaited<ReturnType<H['admin']>>;

beforeEach(async () => {
  h = await harness();
  admin = await h.admin();
  await h.linkConnection(admin);
  safety = { minDelaySeconds: 0, maxDelaySeconds: 0, imageMinDelaySeconds: 0, imageMaxDelaySeconds: 0, imageSendMode: 'single', dailyCap: 100, windowStart: '00:00', windowEnd: '23:59' };
  h.svc.settings.get = () => safety;
  h.svc.queue.start();
});
afterEach(async () => {
  await h.close();
});

const send = async (text: string, groupIds: string[]) => (await admin.post('/api/jobs', { text, groupIds })).body.job.id as number;
const job = (id: number) => h.svc.jobs.get(id)!;

describe('send queue', () => {
  it('sends every group once through the active number, with the exact text', async () => {
    const id = await send('Post https://youtu.be/q1', ['111@g.us', '222@g.us', '333@g.us']);
    await waitFor(() => job(id).status === 'done');
    expect(h.world.sent.map((s) => s.to)).toEqual(['111@g.us', '222@g.us', '333@g.us']);
    expect(h.world.sent.every((s) => s.text === 'Post https://youtu.be/q1')).toBe(true);
    expect(job(id).items!.every((i) => i.connectionId === h.svc.connections.active()!.id)).toBe(true);
  });

  it('stops at the per-connection daily cap and waits', async () => {
    safety.dailyCap = 2;
    const id = await send('Post https://youtu.be/q2', ['111@g.us', '222@g.us', '333@g.us']);
    await waitFor(() => job(id).waitReason === 'daily_cap');
    expect(h.world.sent).toHaveLength(2);
    expect(job(id).pending).toBe(1);
  });

  it('records failures, continues, and retries only failed groups', async () => {
    h.world.failFor.add('222@g.us');
    const id = await send('Post https://youtu.be/q3', ['111@g.us', '222@g.us', '333@g.us']);
    await waitFor(() => job(id).status === 'done');
    expect(job(id).sent).toBe(2);
    expect(job(id).failed).toBe(1);
    h.world.failFor.clear();
    const retry = await admin.post(`/api/jobs/${id}/retry-failed`);
    expect(retry.status).toBe(201);
    expect(retry.body.job.total).toBe(1);
    await waitFor(() => job(retry.body.job.id).status === 'done');
    expect(job(retry.body.job.id).parentJobId).toBe(id);
  });

  it('pauses while the active number is down and resumes when it reconnects', async () => {
    const rt = h.world.latest();
    rt.state = 'reconnecting';
    rt.emit('state', 'reconnecting');
    const id = await send('Post https://youtu.be/q4', ['111@g.us']);
    await waitFor(() => job(id).waitReason === 'connection_down');
    expect(h.world.sent).toHaveLength(0);
    rt.becomeReady();
    h.svc.queue.kick();
    await waitFor(() => job(id).status === 'done');
  });

  it('does not switch numbers automatically when the active one is logged out', async () => {
    const before = h.svc.connections.active()!.id;
    h.world.latest().emit('logged_out', { reason: 'LOGOUT', suspectedBan: false });
    expect(h.svc.connections.active()!.id).toBe(before);
    expect(h.svc.connections.sendingStatus()).toMatchObject({ available: false, accepting: false, reason: 'logged_out' });
  });

  it('marks in-flight messages as failed after a restart (never double-posts)', () => {
    const id = h.svc.jobs.create({ userId: 1, messageText: 'x https://fb.watch/e/', messageSha256: 'h', textKey: 'k', imageId: null, imageSha256: null, sendMode: 'text', links: [], mainLinks: [], warnings: null, presetIds: [], parentJobId: null, requestedConnectionId: null, groups: [{ id: '111@g.us', name: 'A' }] });
    const item = h.svc.jobs.nextPending(id)!;
    h.svc.jobs.markSending(item.id, 'x', '2026-01-01', h.svc.connections.active()!.id, 1);
    expect(h.svc.jobs.recoverInterrupted()).toHaveLength(1);
    expect(job(id).items![0]!.status).toBe('failed');
  });
});
