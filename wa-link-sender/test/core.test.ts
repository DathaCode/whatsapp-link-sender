import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config.js';
import { renderTemplate } from '../src/queue.js';
import { inWindow, localTime } from '../src/time.js';
import { normalizeUrl } from '../src/urls.js';

const ok = (raw: string) => {
  const r = normalizeUrl(raw);
  if (!r.ok) throw new Error(`expected ok for ${raw}: ${r.error}`);
  return r;
};

describe('normalizeUrl', () => {
  it.each([
    ['https://youtu.be/dQw4w9WgXcQ?si=abc123', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube'],
    ['https://youtu.be/dQw4w9WgXcQ?t=42&si=x', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42', 'youtube'],
    ['https://m.youtube.com/watch?v=abc&feature=share&pp=xyz', 'https://www.youtube.com/watch?v=abc', 'youtube'],
    ['https://www.youtube.com/shorts/abc?si=1', 'https://www.youtube.com/shorts/abc', 'youtube'],
    ['https://fb.watch/abcDEF/?mibextid=xyz', 'https://fb.watch/abcDEF/', 'facebook'],
    [
      'https://m.facebook.com/story.php?story_fbid=123&id=456&fbclid=IwAR&utm_source=x',
      'https://www.facebook.com/story.php?story_fbid=123&id=456',
      'facebook',
    ],
    ['https://www.facebook.com/share/v/1AbC/?mibextid=w8EBqM', 'https://www.facebook.com/share/v/1AbC/', 'facebook'],
    ['https://vm.tiktok.com/ZMabc123/', 'https://vm.tiktok.com/ZMabc123/', 'tiktok'],
    [
      'https://www.tiktok.com/@user/video/7300000000000000000?is_from_webapp=1&sender_device=pc&_r=1&_t=8x',
      'https://www.tiktok.com/@user/video/7300000000000000000',
      'tiktok',
    ],
    ['www.youtube.com/watch?v=abc#t=1', 'https://www.youtube.com/watch?v=abc', 'youtube'],
    ['http://YOUTU.BE/abc', 'https://www.youtube.com/watch?v=abc', 'youtube'],
  ])('%s', (input, expected, platform) => {
    const r = ok(input);
    expect(r.url).toBe(expected);
    expect(r.platform).toBe(platform);
  });

  it.each([
    'https://evil.com/youtube.com',
    'https://youtube.com.evil.com/watch?v=1',
    'https://notfacebook.com/post/1',
    'javascript:alert(1)',
    'ftp://youtube.com/x',
    'https://user:pass@youtube.com/watch?v=1',
    'https://www.youtube.com/',
    'hello there',
    '',
  ])('rejects %s', (input) => {
    expect(normalizeUrl(input).ok).toBe(false);
  });
});

describe('sending hours', () => {
  it('same-day window', () => {
    expect(inWindow(8 * 60, '08:00', '21:00')).toBe(true);
    expect(inWindow(21 * 60, '08:00', '21:00')).toBe(false);
    expect(inWindow(7 * 60 + 59, '08:00', '21:00')).toBe(false);
  });
  it('window crossing midnight', () => {
    expect(inWindow(23 * 60, '20:00', '02:00')).toBe(true);
    expect(inWindow(60, '20:00', '02:00')).toBe(true);
    expect(inWindow(3 * 60, '20:00', '02:00')).toBe(false);
  });
  it('local time uses the configured zone', () => {
    // 2026-01-01T20:00Z is 01:30 on Jan 2 in Colombo (UTC+5:30)
    expect(localTime(new Date('2026-01-01T20:00:00Z'), 'Asia/Colombo')).toEqual({ day: '2026-01-02', minutes: 90 });
  });
});

describe('config', () => {
  const base = { ACCESS_KEY: 'a-long-enough-secret' };
  it('applies defaults', () => {
    const r = parseConfig(base);
    expect(r.ok && r.config.PORT).toBe(3100);
    expect(r.ok && r.config.TZ).toBe('Asia/Colombo');
    expect(r.ok && r.config.MIN_DELAY_SECONDS).toBe(15);
    expect(r.ok && r.config.MAX_DELAY_SECONDS).toBe(40);
  });
  it('reports clear errors', () => {
    const r = parseConfig({ ACCESS_KEY: 'short', MIN_DELAY_SECONDS: '50', MAX_DELAY_SECONDS: '10', TZ: 'Mars/Base', SEND_WINDOW_START: '8am' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const all = r.errors.join('\n');
      expect(all).toMatch(/ACCESS_KEY must be at least 12/);
      expect(all).toMatch(/TZ is not a valid time zone/);
      expect(all).toMatch(/SEND_WINDOW_START must look like 08:00/);
    }
  });
  it('rejects max < min delay', () => {
    const r = parseConfig({ ...base, MIN_DELAY_SECONDS: '30', MAX_DELAY_SECONDS: '20' });
    expect(r.ok).toBe(false);
  });
  it('rejects the example key', () => {
    expect(parseConfig({ ACCESS_KEY: 'change-me-to-a-long-secret' }).ok).toBe(false);
  });
});

describe('renderTemplate', () => {
  it('replaces every {url}', () => {
    expect(renderTemplate('A {url} B {url}', 'https://x.y')).toBe('A https://x.y B https://x.y');
  });
  it('appends the link when the placeholder is missing', () => {
    expect(renderTemplate('Hello', 'https://x.y')).toBe('Hello\nhttps://x.y');
  });
});
