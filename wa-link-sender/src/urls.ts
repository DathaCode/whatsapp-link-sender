export type Platform = 'facebook' | 'tiktok' | 'youtube';

export type NormalizeResult =
  | { ok: true; url: string; platform: Platform }
  | { ok: false; error: string };

const PLATFORM_HOSTS: Record<Platform, string[]> = {
  facebook: ['facebook.com', 'fb.watch', 'fb.com', 'fb.me'],
  tiktok: ['tiktok.com'],
  youtube: ['youtube.com', 'youtu.be'],
};

/** Query parameters that only track the sharer and never change what the link points to. */
const TRACKING_PARAMS = new Set([
  'si', 'fbclid', 'gclid', 'dclid', 'msclkid', 'igshid', 'igsh', 'mibextid', 'rdid', 'share_url',
  'feature', 'pp', 'ab_channel', 'embeds_referring_euri', 'source_ve_path',
  '_t', '_r', 'is_from_webapp', 'sender_device', 'sender_web_id', 'share_app_id', 'share_item_id',
  'share_link_id', 'social_share_type', 'tt_from', 'u_code', 'user_id', 'timestamp',
  'refer', 'ref', 'referer', 'checksum', 'sec_uid', 'web_id', 'is_copy_url', 'enter_from',
  'sfnsn', 'extid', '__tn__', 'paipv', 'eav', 'wtsid', 'notif_id', 'notif_t', 'ref_src',
]);
const TRACKING_PREFIXES = ['utm_', '__cft__', '__xts__', 'hc_'];

function platformFor(host: string): Platform | null {
  for (const [platform, hosts] of Object.entries(PLATFORM_HOSTS) as [Platform, string[]][]) {
    if (hosts.some((h) => host === h || host.endsWith('.' + h))) return platform;
  }
  return null;
}

const PLATFORM_LABEL: Record<Platform, string> = { facebook: 'Facebook', tiktok: 'TikTok', youtube: 'YouTube' };
export const platformLabel = (p: Platform) => PLATFORM_LABEL[p];

/**
 * Validates that a pasted link is a Facebook / TikTok / YouTube link, strips
 * tracking parameters and normalizes it so the same post always gives the same URL.
 */
export function normalizeUrl(raw: unknown): NormalizeResult {
  let text = String(raw ?? '').trim();
  if (!text) return { ok: false, error: 'Paste a link first.' };
  if (text.length > 2000) return { ok: false, error: 'That link is too long.' };
  // People often paste "www.youtube.com/..." without the scheme.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = 'https://' + text;

  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return { ok: false, error: 'That does not look like a link. Copy the post link again and paste it here.' };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return { ok: false, error: 'Only web links (https://…) can be sent.' };
  }
  if (u.username || u.password || u.port) {
    return { ok: false, error: 'That link has an unusual format. Copy it straight from the app’s Share button.' };
  }

  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  const platform = platformFor(host);
  if (!platform) {
    return { ok: false, error: 'Only Facebook, TikTok and YouTube links can be sent.' };
  }

  u.protocol = 'https:';
  u.hash = '';

  // Canonical hosts so duplicates are detected regardless of mobile/desktop links.
  if (platform === 'facebook' && /(^|\.)facebook\.com$/.test(host)) u.hostname = 'www.facebook.com';
  else if (platform === 'tiktok' && (host === 'tiktok.com' || host === 'm.tiktok.com')) u.hostname = 'www.tiktok.com';
  else if (platform === 'youtube' && host !== 'youtu.be') u.hostname = 'www.youtube.com';
  else u.hostname = host;

  for (const key of [...u.searchParams.keys()]) {
    const k = key.toLowerCase();
    if (TRACKING_PARAMS.has(k) || TRACKING_PREFIXES.some((p) => k.startsWith(p))) u.searchParams.delete(key);
  }

  // youtu.be/ID?t=10  ->  www.youtube.com/watch?v=ID&t=10
  if (u.hostname === 'youtu.be') {
    const id = u.pathname.split('/').filter(Boolean)[0];
    if (!id) return { ok: false, error: 'That YouTube link is missing the video. Copy it again.' };
    const t = u.searchParams.get('t');
    const out = new URL('https://www.youtube.com/watch');
    out.searchParams.set('v', id);
    if (t) out.searchParams.set('t', t);
    return { ok: true, url: out.toString(), platform };
  }

  if (u.pathname === '/' && !u.search) {
    return { ok: false, error: `That is the ${PLATFORM_LABEL[platform]} home page, not a post. Copy the post’s own link.` };
  }

  let out = u.toString();
  if (out.endsWith('?')) out = out.slice(0, -1);
  return { ok: true, url: out, platform };
}
