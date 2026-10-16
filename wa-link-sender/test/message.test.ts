import { describe, expect, it } from 'vitest';
import {
  CAPTION_MAX,
  DEFAULT_ALLOWED_DOMAINS,
  DEFAULT_REPEATING_LINKS,
  canonicalLink,
  charCount,
  cleanLink,
  cleanMessage,
  disallowedHosts,
  extractLinks,
  isAllowedHost,
  mainLinks,
  normalizeMessage,
  textKey,
} from '../src/message.js';
import { FOOTER, POST } from './fixtures.js';

describe('exact text', () => {
  it('keeps Sinhala ZWJ, mathematical bold letters, emoji, blank lines and double spaces', () => {
    const out = normalizeMessage(POST);
    expect(out).toBe(POST);
    expect(Buffer.from(out, 'utf8').equals(Buffer.from(POST, 'utf8'))).toBe(true);
    expect(out).toContain('‍');
    expect(out).toContain('𝗢𝗟𝗟𝗢𝗪');
    expect(out).toContain('🟠  YouTube');
  });

  it('only trims the outer whitespace and normalizes CRLF', () => {
    expect(normalizeMessage('  \r\n a\r\n\r\nb  c \r\n ')).toBe('a\n\nb  c');
    expect(normalizeMessage('x\ry')).toBe('x\ny');
  });

  it('cleaning a message without tracking parameters changes nothing at all', () => {
    expect(cleanMessage(POST).text).toBe(POST);
  });

  it('counts characters as code points', () => {
    expect(charCount('𝗢🟠ව්‍ය')).toBe(6);
  });
});

describe('links', () => {
  it('finds explicit, www and bare links and trims sentence punctuation', () => {
    const t = 'See https://hiru.lk/a?b=1. Also www.youtube.com/watch?v=x, and hiru.lk/d6ZAW1! (fb.watch/abc) mail me@x.com Mr.Smith file.txt';
    expect(extractLinks(t).map((l) => l.raw)).toEqual(['https://hiru.lk/a?b=1', 'www.youtube.com/watch?v=x', 'hiru.lk/d6ZAW1', 'fb.watch/abc']);
  });

  it('finds every link in the real post', () => {
    expect(extractLinks(POST).map((l) => l.host)).toEqual(['hiru.lk', 'youtube.com', 'facebook.com', 'tiktok.com']);
  });

  it('removes tracking parameters and keeps everything else as written', () => {
    expect(cleanLink('https://youtu.be/abc?si=XYZ')).toBe('https://youtu.be/abc');
    expect(cleanLink('https://www.youtube.com/watch?v=abc&si=1&t=30#c')).toBe('https://www.youtube.com/watch?v=abc&t=30#c');
    expect(cleanLink('https://www.facebook.com/reel/123/?app=fbl&fbclid=IwAR&mibextid=x')).toBe('https://www.facebook.com/reel/123/');
    expect(
      cleanLink('https://www.tiktok.com/@h/video/1?_r=1&enter_from_merge=x&enter_method=y&is_from_webapp=1&sender_device=pc&utm_source=z&lang=si'),
    ).toBe('https://www.tiktok.com/@h/video/1?lang=si');
    expect(cleanLink('hiru.lk/x?utm_campaign=a')).toBe('hiru.lk/x');
  });

  it('cleans links inside the message without touching the rest', () => {
    const r = cleanMessage('ව්‍ය 👉 https://youtu.be/abc?si=XYZ\n\n𝗢𝗞');
    expect(r.text).toBe('ව්‍ය 👉 https://youtu.be/abc\n\n𝗢𝗞');
    expect(r.links).toEqual([{ original: 'https://youtu.be/abc?si=XYZ', cleaned: 'https://youtu.be/abc', host: 'youtu.be' }]);
  });
});

describe('allowed domains', () => {
  it('allows listed domains and their subdomains only', () => {
    expect(isAllowedHost('m.facebook.com', DEFAULT_ALLOWED_DOMAINS)).toBe(true);
    expect(isAllowedHost('hiru.lk', DEFAULT_ALLOWED_DOMAINS)).toBe(true);
    expect(isAllowedHost('evilfacebook.com', DEFAULT_ALLOWED_DOMAINS)).toBe(false);
    expect(isAllowedHost('facebook.com.evil.io', DEFAULT_ALLOWED_DOMAINS)).toBe(false);
  });

  it('lists the disallowed hosts of a message', () => {
    const { links } = cleanMessage('a https://hiru.lk/x b https://bit.ly/zz c example.com/q');
    expect(disallowedHosts(links, DEFAULT_ALLOWED_DOMAINS)).toEqual(['bit.ly', 'example.com']);
  });
});

describe('duplicate keys', () => {
  const snippets = [FOOTER];

  it('footer links are never main links', () => {
    const { links } = cleanMessage(POST);
    expect(mainLinks(links, snippets, DEFAULT_REPEATING_LINKS)).toEqual(['hiru.lk/d6ZAW1']);
    // Even without the snippet list, the repeating-links list covers the footer.
    expect(mainLinks(links, [], DEFAULT_REPEATING_LINKS)).toEqual(['hiru.lk/d6ZAW1']);
  });

  it('the same main link matches across spelling variants', () => {
    expect(canonicalLink('https://www.youtube.com/watch?v=abc&si=1')).toBe(canonicalLink('youtube.com/watch?v=abc'));
    expect(canonicalLink('https://m.facebook.com/hirunews/')).toBe(canonicalLink('https://www.facebook.com/hirunews'));
  });

  it('text key ignores whitespace differences only', () => {
    expect(textKey('a  b\n\nc')).toBe(textKey('a b c'));
    expect(textKey('a b c')).not.toBe(textKey('a b d'));
  });

  it('caption limit is 1024', () => {
    expect(CAPTION_MAX).toBe(1024);
  });
});
