import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizeMessage } from '../src/message.js';
import type { SafetySettings } from '../src/settings.js';
import { harness, waitFor, type Client } from './helpers.js';
import { FOOTER, POST } from './fixtures.js';

type H = Awaited<ReturnType<typeof harness>>;
let h: H;
let admin: Client;
let safety: SafetySettings;

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

const job = (id: number) => h.svc.jobs.get(id)!;
const done = (id: number) => waitFor(() => job(id).status === 'done', 5000);
const upload = (c: Client, buf: Buffer, name: string) =>
  c.agent.post('/api/uploads').set('x-csrf-token', c.csrf).set('content-type', 'application/octet-stream').set('x-file-name', encodeURIComponent(name)).send(buf);
const jpegWithExif = (w = 2400, hgt = 1200, color = '#cc0000') =>
  sharp({ create: { width: w, height: hgt, channels: 3, background: color } })
    .jpeg()
    .withMetadata({ exif: { IFD0: { Copyright: 'Secret Co', Artist: 'Photographer', ImageDescription: 'GPS here' } } })
    .toBuffer();

describe('exact text round-trip', () => {
  it('sends Sinhala with ZWJ, 𝗢𝗟𝗟𝗢𝗪 letters, emoji and blank lines byte for byte', async () => {
    const r = await admin.post('/api/jobs', { text: `\r\n  ${POST.replace(/\n/g, '\r\n')}  \n\n`, groupIds: ['111@g.us'] });
    expect(r.status).toBe(201);
    await done(r.body.job.id);
    const sent = h.world.sent[0]!.text;
    expect(Buffer.from(sent, 'utf8').equals(Buffer.from(POST, 'utf8'))).toBe(true);
    expect(sent).toBe(normalizeMessage(POST));
    expect(job(r.body.job.id).messageText).toBe(POST);
  });

  it('only removes tracking parameters', async () => {
    const r = await admin.post('/api/jobs', { text: 'ව්‍ය 👉 https://youtu.be/abc?si=XYZ&t=5\n\n𝗢𝗞', groupIds: ['111@g.us'] });
    await done(r.body.job.id);
    expect(h.world.sent[0]!.text).toBe('ව්‍ය 👉 https://youtu.be/abc?t=5\n\n𝗢𝗞');
  });

  it('the preview check returns exactly what will be sent', async () => {
    const r = await admin.post('/api/messages/check', { text: 'Read https://hiru.lk/x?fbclid=1 now' });
    expect(r.body.text).toBe('Read https://hiru.lk/x now');
    expect(r.body.links).toEqual([{ original: 'https://hiru.lk/x?fbclid=1', cleaned: 'https://hiru.lk/x', host: 'hiru.lk', allowed: true, main: true }]);
  });

  it('refuses an empty message', async () => {
    const r = await admin.post('/api/jobs', { text: ' \n\t ', groupIds: ['111@g.us'] });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('empty_message');
  });
});

describe('allowed domains', () => {
  it('a USER cannot send links outside the list; it is logged', async () => {
    const p = (await admin.post('/api/admin/presets', { name: 'P', groups: [{ id: '111@g.us', name: 'Alpha group' }] })).body.preset;
    const u = await h.makeUser(admin, 'uma', [p.id]);
    const r = await u.client.post('/api/jobs', { text: 'Look https://bit.ly/x', groupIds: ['111@g.us'], presetIds: [p.id], confirmLinks: true });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('link_not_allowed');
    const row = h.actions().find((a) => a.action === 'send.blocked' && a.reason === 'link_not_allowed')!;
    expect(row.outcome).toBe('denied');
    expect(JSON.parse(row.details!).hosts).toEqual(['bit.ly']);
  });

  it('an ADMIN is warned and can confirm', async () => {
    const first = await admin.post('/api/jobs', { text: 'Look https://bit.ly/x', groupIds: ['111@g.us'] });
    expect(first.status).toBe(409);
    expect(first.body.code).toBe('links_need_confirmation');
    const ok = await admin.post('/api/jobs', { text: 'Look https://bit.ly/x', groupIds: ['111@g.us'], confirmLinks: true });
    expect(ok.status).toBe(201);
    expect(h.actions().some((a) => a.action === 'send.links_confirmed')).toBe(true);
    expect(job(ok.body.job.id).warnings).toMatchObject({ disallowedLinks: { hosts: ['bit.ly'], resolution: 'confirmed by admin' } });
  });

  it('the allowed list is admin-managed and audited', async () => {
    const r = await admin.put('/api/admin/settings/messaging', { allowedDomains: ['hiru.lk', 'https://www.Bit.ly/'] });
    expect(r.body.messaging.allowedDomains).toEqual(['hiru.lk', 'bit.ly']);
    expect(h.actions().some((a) => a.action === 'settings.updated' && a.targetId === 'messaging')).toBe(true);
  });
});

describe('duplicate detection', () => {
  it('footer links never trigger it; the same main link does', async () => {
    const a = await admin.post('/api/jobs', { text: `Story one https://hiru.lk/aaa\n\n${FOOTER}`, groupIds: ['111@g.us'] });
    expect(a.status).toBe(201);
    const b = await admin.post('/api/jobs', { text: `Story two https://hiru.lk/bbb\n\n${FOOTER}`, groupIds: ['111@g.us'] });
    expect(b.status).toBe(201); // same footer, different main link: not a duplicate
    const c = await admin.post('/api/jobs', { text: `Totally new words https://www.hiru.lk/aaa/?utm_source=x`, groupIds: ['111@g.us'] });
    expect(c.status).toBe(409);
    expect(c.body.duplicate.reasons).toContain('same link: hiru.lk/aaa');
    const d = await admin.post('/api/jobs', { text: `Totally new words https://www.hiru.lk/aaa/?utm_source=x`, groupIds: ['111@g.us'], confirmDuplicate: true });
    expect(d.status).toBe(201);
    const row = h.actions().find((x) => x.action === 'send.duplicate_confirmed')!;
    expect(JSON.parse(row.details!).reasons).toContain('same link: hiru.lk/aaa');
  });

  it('the same text (whitespace aside) is a duplicate', async () => {
    await admin.post('/api/jobs', { text: 'Hello   team\n\nnews', groupIds: ['111@g.us'] });
    const r = await admin.post('/api/jobs', { text: 'Hello team news', groupIds: ['111@g.us'] });
    expect(r.status).toBe(409);
    expect(r.body.duplicate.reasons).toContain('same message text');
  });

  it('the same image is a duplicate even with new text', async () => {
    const img = await jpegWithExif();
    const up1 = await upload(admin, img, 'a.jpg');
    await admin.post('/api/jobs', { text: 'First caption', uploadId: up1.body.image.id, groupIds: ['111@g.us'] });
    const up2 = await upload(admin, img, 'same-file-again.jpg');
    const r = await admin.post('/api/jobs', { text: 'Different caption', uploadId: up2.body.image.id, groupIds: ['111@g.us'] });
    expect(r.status).toBe(409);
    expect(r.body.duplicate.reasons).toContain('same image');
  });
});

describe('images', () => {
  it('rejects a non-image renamed .jpg (content is checked)', async () => {
    const r = await upload(admin, Buffer.from('%PDF-1.7 not really a picture'), 'photo.jpg');
    expect(r.status).toBe(415);
    expect(h.actions().some((a) => a.action === 'upload.rejected' && a.reason === 'not_an_image')).toBe(true);
  });

  it('rejects images over 5 MB', async () => {
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(5 * 1024 * 1024 + 10)]);
    const r = await upload(admin, big, 'big.jpg');
    expect(r.status).toBe(413);
  });

  it('re-encodes to JPEG ≤1600 px and strips all metadata', async () => {
    const r = await upload(admin, await jpegWithExif(2400, 1200), 'holiday.jpg');
    expect(r.status).toBe(201);
    expect(r.body.image).toMatchObject({ width: 1600, height: 800, originalName: 'holiday.jpg', originalType: 'jpeg' });
    const meta = await sharp(h.svc.images.fileOf(r.body.image.id)).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
  });

  it('accepts PNG and WebP and only lets the uploader (or an admin) view it', async () => {
    const png = await sharp({ create: { width: 10, height: 10, channels: 4, background: '#00ff0080' } }).png().toBuffer();
    const p = (await admin.post('/api/admin/presets', { name: 'P', groups: [{ id: '111@g.us', name: 'Alpha group' }] })).body.preset;
    const u = await h.makeUser(admin, 'ivy', [p.id]);
    const other = await h.makeUser(admin, 'oli', [p.id]);
    const up = await upload(u.client, png, 'dot.png');
    expect(up.status).toBe(201);
    expect((await u.client.get(`/api/uploads/${up.body.image.id}`)).headers['content-type']).toBe('image/jpeg');
    expect((await admin.get(`/api/uploads/${up.body.image.id}`)).status).toBe(200);
    expect((await other.client.get(`/api/uploads/${up.body.image.id}`)).status).toBe(403);
    const webp = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#0000ff' } }).webp().toBuffer();
    expect((await upload(u.client, webp, 'x.webp')).status).toBe(201);
  });

  it('sends image + caption as one message by default', async () => {
    const up = await upload(admin, await jpegWithExif(), 'p.jpg');
    const r = await admin.post('/api/jobs', { text: POST, uploadId: up.body.image.id, groupIds: ['111@g.us'] });
    await done(r.body.job.id);
    expect(h.world.sent[0]).toMatchObject({ text: POST, mode: 'single' });
    expect(h.world.sent[0]!.imagePath).toContain(up.body.image.id);
  });

  it('caption limit: 1024 characters with an image in single mode', async () => {
    const up = await upload(admin, await jpegWithExif(), 'p.jpg');
    const long = 'අ'.repeat(1025);
    const r = await admin.post('/api/jobs', { text: long, uploadId: up.body.image.id, groupIds: ['111@g.us'] });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('too_long');
    safety.imageSendMode = 'two';
    expect((await admin.post('/api/jobs', { text: long, uploadId: up.body.image.id, groupIds: ['111@g.us'] })).status).toBe(201);
  });

  it('two-message mode counts 2 messages per group against the daily cap', async () => {
    safety.imageSendMode = 'two';
    safety.dailyCap = 3;
    const up = await upload(admin, await jpegWithExif(), 'p.jpg');
    const r = await admin.post('/api/jobs', { text: 'Two part post', uploadId: up.body.image.id, groupIds: ['111@g.us', '222@g.us'] });
    await waitFor(() => job(r.body.job.id).waitReason === 'daily_cap');
    expect(h.world.sent).toHaveLength(1);
    expect(h.world.sent[0]!.mode).toBe('two');
    expect(h.svc.queue.usage().used).toBe(2);
  });
});

describe('retry rule', () => {
  it('retries once when nothing was sent', async () => {
    h.world.prepFailOnce.add('111@g.us');
    const r = await admin.post('/api/jobs', { text: 'Retry me', groupIds: ['111@g.us'] });
    await done(r.body.job.id);
    expect(job(r.body.job.id).sent).toBe(1);
    const result = h.actions().filter((a) => a.action === 'send.result').at(-1)!;
    expect(JSON.parse(result.details!).attempts).toBe(2);
  });

  it('never retries when WhatsApp may already have sent it', async () => {
    h.world.failFor.add('111@g.us');
    const r = await admin.post('/api/jobs', { text: 'Maybe sent', groupIds: ['111@g.us'] });
    await done(r.body.job.id);
    const item = job(r.body.job.id).items![0]!;
    expect(item.status).toBe('failed');
    expect(item.error).toMatch(/check the group before retrying/i);
    const result = h.actions().filter((a) => a.action === 'send.result').at(-1)!;
    expect(JSON.parse(result.details!)).toMatchObject({ attempts: 1, mayHaveBeenSent: true });
  });
});

describe('audit details & drafts', () => {
  it('send.requested and per-group results carry the full text, hash, links, image and mode', async () => {
    const up = await upload(admin, await jpegWithExif(), 'cover.jpg');
    const r = await admin.post('/api/jobs', { text: 'Big news https://hiru.lk/x?utm_source=wa', uploadId: up.body.image.id, groupIds: ['111@g.us'] });
    await done(r.body.job.id);
    for (const action of ['send.requested', 'send.result']) {
      const d = JSON.parse(h.actions().find((a) => a.action === action)!.details!);
      expect(d.messageText).toBe('Big news https://hiru.lk/x');
      expect(d.messageSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(d.links).toEqual([{ original: 'https://hiru.lk/x?utm_source=wa', cleaned: 'https://hiru.lk/x', host: 'hiru.lk' }]);
      expect(d.image).toMatchObject({ id: up.body.image.id, originalName: 'cover.jpg' });
      expect(d.image.originalSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(d.sendMode).toBe('single');
    }
  });

  it('drafts are saved per user, exactly', async () => {
    await admin.put('/api/drafts', { text: POST, uploadId: null });
    expect((await admin.get('/api/drafts')).body.draft.text).toBe(POST);
    await admin.del('/api/drafts');
    expect((await admin.get('/api/drafts')).body.draft.text).toBe('');
  });

  it('snippets are admin-managed and offered to users', async () => {
    const r = await admin.post('/api/admin/snippets', { name: 'Sign-off', body: '— Hiru News 🟠' });
    expect(r.status).toBe(201);
    const opts = (await admin.get('/api/send/options')).body;
    expect(opts.snippets.map((s: { name: string }) => s.name)).toEqual(['Follow us footer', 'Sign-off']);
    expect(opts.snippets[0].body).toBe(FOOTER);
  });
});
