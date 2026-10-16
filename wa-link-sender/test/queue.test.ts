import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '../src/config.js';
import { Store } from '../src/db.js';
import { EventHub } from '../src/events.js';
import { logger } from '../src/logger.js';
import { SendQueue } from '../src/queue.js';
import type { SafetySettings, Settings } from '../src/settings.js';
import type { WhatsApp } from '../src/whatsapp.js';
import { NotConnectedError } from '../src/whatsapp.js';

logger.level = 'silent';

class FakeWa {
  ready = true;
  sent: { to: string; text: string }[] = [];
  failFor = new Set<string>();
  isReady() {
    return this.ready;
  }
  async sendText(to: string, text: string) {
    if (!this.ready) throw new NotConnectedError();
    if (this.failFor.has(to)) throw new Error('boom');
    this.sent.push({ to, text });
  }
}

const cfg = { TZ: 'Asia/Colombo' } as Config;
let dir: string;
let store: Store;
let wa: FakeWa;
let safety: SafetySettings;
let queue: SendQueue;
let hub: EventHub;

const groups = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `g${i}@g.us`, name: `Group ${i}` }));
const waitFor = async (fn: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 10));
  }
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wls-'));
  store = new Store(dir);
  store.replaceGroups(groups(6).map((g) => ({ ...g, readOnly: false })));
  wa = new FakeWa();
  safety = { minDelaySeconds: 0, maxDelaySeconds: 0, dailyCap: 100, windowStart: '00:00', windowEnd: '23:59' };
  const settings = { get: () => safety } as unknown as Settings;
  hub = new EventHub();
  queue = new SendQueue(cfg, store, wa as unknown as WhatsApp, settings, hub, logger);
});

afterEach(async () => {
  await queue.stop();
  hub.close();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('SendQueue', () => {
  it('sends every group once, using a template', async () => {
    queue.start();
    const id = queue.enqueue({ url: 'https://www.youtube.com/watch?v=x', platform: 'youtube', templateId: null, groups: groups(4) });
    await waitFor(() => store.getJob(id)!.status === 'done');
    expect(wa.sent.map((s) => s.to)).toEqual(['g0@g.us', 'g1@g.us', 'g2@g.us', 'g3@g.us']);
    expect(wa.sent.every((s) => s.text.includes('https://www.youtube.com/watch?v=x'))).toBe(true);
  });

  it('stops at the daily cap and waits', async () => {
    safety.dailyCap = 2;
    queue.start();
    const id = queue.enqueue({ url: 'https://fb.watch/a/', platform: 'facebook', templateId: null, groups: groups(5) });
    await waitFor(() => store.getJob(id)!.waitReason === 'daily_cap');
    expect(wa.sent).toHaveLength(2);
    expect(store.getJob(id)!.pending).toBe(3);
  });

  it('records failures and continues, then retries only failed groups', async () => {
    wa.failFor.add('g1@g.us');
    queue.start();
    const id = queue.enqueue({ url: 'https://fb.watch/b/', platform: 'facebook', templateId: null, groups: groups(3) });
    await waitFor(() => store.getJob(id)!.status === 'done');
    const job = store.getJob(id)!;
    expect(job.sent).toBe(2);
    expect(job.failed).toBe(1);
    expect(store.failedItems(id)).toEqual([{ id: 'g1@g.us', name: 'Group 1' }]);
  });

  it('waits while WhatsApp is offline and resumes when it is back', async () => {
    wa.ready = false;
    queue.start();
    const id = queue.enqueue({ url: 'https://fb.watch/c/', platform: 'facebook', templateId: null, groups: groups(2) });
    await waitFor(() => store.getJob(id)!.waitReason === 'whatsapp_offline');
    expect(wa.sent).toHaveLength(0);
    wa.ready = true;
    queue.kick();
    await waitFor(() => store.getJob(id)!.status === 'done');
    expect(wa.sent).toHaveLength(2);
  });

  it('cancel skips groups not yet reached', async () => {
    safety.minDelaySeconds = safety.maxDelaySeconds = 60; // long pause after first send
    queue.start();
    (queue as unknown as { nextSendAt: number }).nextSendAt = 0;
    queue.kick();
    const id = queue.enqueue({ url: 'https://fb.watch/d/', platform: 'facebook', templateId: null, groups: groups(4) });
    await waitFor(() => wa.sent.length === 1);
    expect(queue.cancel(id)).toBe(true);
    const job = store.getJob(id)!;
    expect(job.status).toBe('cancelled');
    expect(job.items.filter((i) => i.status === 'cancelled')).toHaveLength(3);
  });

  it('marks in-flight messages as failed after a restart (never double-posts)', () => {
    const id = store.createJob({ url: 'https://fb.watch/e/', platform: 'facebook', templateId: null, parentJobId: null, groups: groups(2) });
    const item = store.nextPendingItem(id)!;
    store.markItemSending(item.id, 'x', '2026-01-01');
    expect(store.recoverInterruptedItems()).toBe(1);
    expect(store.getJob(id)!.items[0]!.status).toBe('failed');
  });
});
