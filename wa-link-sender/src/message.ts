/**
 * The message text: exact preservation, link extraction, tracking-parameter cleanup,
 * allowed domains and duplicate keys. Pure functions, unit-tested.
 *
 * Exactness rules (critical for Sinhala and styled text):
 *   - NO Unicode normalization (NFC/NFKC/...): "𝗢𝗟𝗟𝗢𝗪" and Sinhala conjuncts must stay as typed.
 *   - NO stripping of zero-width characters: Sinhala needs U+200D (ZWJ), e.g. "ව්‍යාපාරයේ".
 *   - Line breaks, blank lines, double spaces and emoji are kept.
 *   - Only: CRLF/CR → LF, and trimming whitespace at the very start and end of the whole message.
 *   - The only content change is removing tracking parameters from links.
 */
import crypto from 'node:crypto';

/** WhatsApp limits (characters = Unicode code points). */
export const TEXT_MAX = 65_536;
export const CAPTION_MAX = 1_024;

export function normalizeMessage(raw: unknown): string {
  return String(raw ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/^\s+|\s+$/g, '');
}

export const charCount = (text: string) => [...text].length;
export const sha256 = (data: string | Buffer) => crypto.createHash('sha256').update(data).digest('hex');

// ---------------------------------------------------------------- links

export interface FoundLink {
  /** Exactly as it appears in the text. */
  raw: string;
  start: number;
  end: number;
  /** Host in lower case, without "www." */
  host: string;
}

/** Common generic TLDs; any two-letter TLD (country code) is also accepted for bare domains. */
const GENERIC_TLDS = new Set(
  'com net org info biz io co app dev news me tv ly gl gle to xyz online site store shop blog live media link page top club web tech ai art pro asia mobi name tel travel jobs edu gov mil int lk watch video social tube'.split(' '),
);

// http(s)://… or www.… or bare domain.tld[/path]. Stops at whitespace and at characters that can't end a URL.
const LINK_RE =
  /\b(?:https?:\/\/[^\s<>"'`]+|www\.[^\s<>"'`]+|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}(?:[/?#][^\s<>"'`]*)?)/giu;

/** Strip punctuation that ends a sentence rather than the URL (keep a closing ")" if the URL opened one). */
function trimTrailing(url: string): string {
  let u = url;
  for (;;) {
    const last = u.at(-1);
    if (!last) return u;
    if ('.,!?:;*_~\'"'.includes(last)) {
      u = u.slice(0, -1);
      continue;
    }
    if (last === ')' && (u.match(/\(/g)?.length ?? 0) < (u.match(/\)/g)?.length ?? 0)) {
      u = u.slice(0, -1);
      continue;
    }
    return u;
  }
}

function hostOf(raw: string): string | null {
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return u.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  } catch {
    return null;
  }
}

/** `known`: domains always recognised as links even without http(s):// (e.g. the allowed-domains list). */
export function extractLinks(text: string, known: string[] = []): FoundLink[] {
  const out: FoundLink[] = [];
  for (const m of text.matchAll(LINK_RE)) {
    const raw = trimTrailing(m[0]);
    const start = m.index!;
    // Skip e-mail addresses (the "domain" part after @).
    if (start > 0 && text[start - 1] === '@') continue;
    const host = hostOf(raw);
    if (!host || !host.includes('.')) continue;
    const explicit = /^(https?:\/\/|www\.)/i.test(raw);
    if (!explicit) {
      const tld = host.split('.').at(-1)!;
      if (!(tld.length === 2 || GENERIC_TLDS.has(tld) || isAllowedHost(host, known))) continue; // "Mr.Smith", "file.txt"…
    }
    out.push({ raw, start, end: start + raw.length, host });
  }
  return out;
}

/** Parameters that only identify who shared a link. */
const TRACKING_PARAMS = new Set([
  'si', 'fbclid', 'gclid', 'dclid', 'msclkid', 'igshid', 'igsh', 'mibextid', 'rdid', 'share_url', 'feature', 'pp',
  'ab_channel', 'embeds_referring_euri', 'source_ve_path', '_t', '_r', 'is_from_webapp', 'sender_device', 'sender_web_id',
  'share_app_id', 'share_item_id', 'share_link_id', 'social_share_type', 'tt_from', 'u_code', 'user_id', 'timestamp',
  'refer', 'referer', 'checksum', 'sec_uid', 'web_id', 'is_copy_url', 'enter_from', 'enter_from_merge', 'enter_method',
  'sfnsn', 'extid', '__tn__', 'paipv', 'eav', 'wtsid', 'notif_id', 'notif_t', 'ref_src', 'app', 'previous_page',
]);
const TRACKING_PREFIXES = ['utm_', '__cft__', '__xts__', 'hc_'];
const isTracking = (key: string) => {
  const k = key.toLowerCase();
  return TRACKING_PARAMS.has(k) || TRACKING_PREFIXES.some((p) => k.startsWith(p));
};

/**
 * Removes tracking parameters, keeping everything else exactly as written (scheme or no scheme,
 * host spelling, path, fragment, the order and encoding of the remaining parameters).
 */
export function cleanLink(raw: string): string {
  const q = raw.indexOf('?');
  if (q < 0) return raw;
  const hashAt = raw.indexOf('#', q);
  const query = raw.slice(q + 1, hashAt < 0 ? undefined : hashAt);
  const fragment = hashAt < 0 ? '' : raw.slice(hashAt);
  const kept = query
    .split('&')
    .filter((pair) => pair !== '' && !isTracking(decodeSafe(pair.split('=')[0] ?? '')));
  return raw.slice(0, q) + (kept.length ? `?${kept.join('&')}` : '') + fragment;
}

function decodeSafe(s: string) {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
}

export interface MessageLink {
  original: string;
  cleaned: string;
  host: string;
}

/** Cleans every link in place. All other characters are untouched. */
export function cleanMessage(text: string, known: string[] = []): { text: string; links: MessageLink[] } {
  const found = extractLinks(text, known);
  let out = '';
  let pos = 0;
  const links: MessageLink[] = [];
  for (const l of found) {
    const cleaned = cleanLink(l.raw);
    out += text.slice(pos, l.start) + cleaned;
    pos = l.end;
    links.push({ original: l.raw, cleaned, host: l.host });
  }
  out += text.slice(pos);
  return { text: out, links };
}

// ---------------------------------------------------------------- allowed domains

export function normalizeDomain(d: string): string {
  return d
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/?#].*$/, '')
    .replace(/\.$/, '');
}

/** A host is allowed when it equals an allowed domain or is a subdomain of one (m.facebook.com → facebook.com). */
export function isAllowedHost(host: string, allowed: string[]): boolean {
  const h = normalizeDomain(host);
  return allowed.map(normalizeDomain).some((d) => d && (h === d || h.endsWith(`.${d}`)));
}

export function disallowedHosts(links: MessageLink[], allowed: string[]): string[] {
  return [...new Set(links.filter((l) => !isAllowedHost(l.host, allowed)).map((l) => l.host))];
}

// ---------------------------------------------------------------- duplicates

/** Whitespace collapsed, for comparison only (never for sending). */
export function textKey(text: string): string {
  return sha256(text.replace(/\s+/g, ' ').trim());
}

/** Canonical form of a link for comparison: https, no www/m., lower-case host, no trailing slash, tracking removed. */
export function canonicalLink(raw: string): string {
  const cleaned = cleanLink(raw);
  try {
    const u = new URL(/^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`);
    const host = u.hostname.toLowerCase().replace(/^(www|m|mobile|web)\./, '');
    const path = u.pathname.replace(/\/+$/, '');
    return `${host}${path}${u.search}`;
  } catch {
    return cleaned.toLowerCase();
  }
}

/**
 * "Main" links: the ones that identify the post. Links that appear in any saved snippet
 * (e.g. the FOLLOW US footer) or in the admin's repeating-links list are not main links.
 */
export function mainLinks(links: MessageLink[], snippets: string[], repeating: string[]): string[] {
  const ignore = new Set<string>([
    ...repeating.map(canonicalLink),
    ...snippets.flatMap((s) => extractLinks(s).map((l) => canonicalLink(l.raw))),
  ]);
  return [...new Set(links.map((l) => canonicalLink(l.cleaned)).filter((c) => !ignore.has(c)))];
}

export const DEFAULT_ALLOWED_DOMAINS = ['hiru.lk', 'hirunews.lk', 'youtube.com', 'youtu.be', 'facebook.com', 'fb.watch', 'tiktok.com'];
export const DEFAULT_REPEATING_LINKS = [
  'https://www.youtube.com/@HiruNewsOfficial',
  'https://www.facebook.com/hirunews',
  'https://www.tiktok.com/@hirunews',
];
