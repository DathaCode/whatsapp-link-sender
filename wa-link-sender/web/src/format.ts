import type { ConnectionStatus, PauseReason, Platform, SafetySettings, WaitReason } from './types';

export const PLATFORM_NAME: Record<Platform, string> = { facebook: 'Facebook', tiktok: 'TikTok', youtube: 'YouTube' };

/** Rough send time: pauses between groups (average) plus ~4 s per message for typing and sending. */
export function estimateSeconds(groups: number, s: SafetySettings, withImage = false): number {
  if (groups <= 0) return 0;
  const avgPause = withImage ? (s.imageMinDelaySeconds + s.imageMaxDelaySeconds) / 2 : (s.minDelaySeconds + s.maxDelaySeconds) / 2;
  return Math.round((groups - 1) * avgPause + groups * (withImage ? 8 : 4));
}

/** First non-empty lines of a message, for lists. */
export function firstLines(text: string, n = 2): string {
  return text
    .split('\n')
    .filter((l) => l.trim())
    .slice(0, n)
    .join('\n');
}

export const formatBytes = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} sec`;
  const min = Math.round(seconds / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Date/time in the app's configured time zone (TZ), so everyone sees the same clock. */
let appTimeZone: string | undefined;
export const setAppTimeZone = (tz: string) => {
  appTimeZone = tz;
};
export const formatDateTime = (ms: number) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: appTimeZone }).format(new Date(ms));
export const formatTime = (ms: number) =>
  new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: appTimeZone }).format(new Date(ms));
export const formatDate = (ms: number) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: appTimeZone }).format(new Date(ms));

export function timeAgo(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return formatDateTime(ms);
}

export function waitReasonText(reason: WaitReason, s: SafetySettings | null): string {
  switch (reason) {
    case 'outside_hours':
      return `Paused: outside sending hours. Sending continues at ${s?.windowStart ?? 'the start of sending hours'}.`;
    case 'daily_cap':
      return `Paused: today’s limit${s ? ` of ${s.dailyCap} messages` : ''} is reached. Sending continues tomorrow.`;
    case 'connection_down':
      return 'Paused: the WhatsApp number is not connected. Sending continues when it is back.';
    default:
      return '';
  }
}

/** Minutes since midnight in the app's time zone (TZ), not the browser's. */
function minutesNow(tz?: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz ?? appTimeZone }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get('hour') * 60 + get('minute');
}
const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** True when sending is outside the configured hours right now (windows may cross midnight). */
export function outsideSendingHours(s: SafetySettings, tz?: string): boolean {
  const now = minutesNow(tz);
  const a = toMin(s.windowStart);
  const b = toMin(s.windowEnd);
  const inside = a < b ? now >= a && now < b : now >= a || now < b;
  return !inside;
}

/**
 * Why a new send would not go out right away (null = it starts now, apart from the normal pause).
 * Shown before sending so a parked send never looks like a hang.
 */
export function whenItSends(s: SafetySettings | null, usage: { used: number; cap: number } | null, weight: number, tz?: string): string | null {
  if (!s) return null;
  if (outsideSendingHours(s, tz)) {
    return `It’s outside sending hours (${s.windowStart}–${s.windowEnd}), so this post will wait and go out automatically at ${s.windowStart}.`;
  }
  if (usage && usage.used + weight > usage.cap) {
    return `Today’s limit of ${usage.cap} messages is reached, so this post will wait and go out automatically tomorrow at ${s.windowStart}.`;
  }
  return null;
}

export const CONNECTION_LABEL: Record<ConnectionStatus, string> = {
  linking: 'Waiting for QR scan',
  link_expired: 'QR expired',
  standby: 'Standby',
  connecting: 'Connecting…',
  connected: 'Connected',
  disconnected: 'Reconnecting…',
  logged_out: 'Logged out',
  possibly_banned: 'Possibly banned',
  retired: 'Removed',
};

export type Tone = 'ok' | 'warn' | 'bad' | 'neutral' | 'accent';
export const CONNECTION_TONE: Record<ConnectionStatus, Tone> = {
  linking: 'accent',
  link_expired: 'neutral',
  standby: 'neutral',
  connecting: 'neutral',
  connected: 'ok',
  disconnected: 'warn',
  logged_out: 'bad',
  possibly_banned: 'bad',
  retired: 'neutral',
};

export function pauseText(reason: PauseReason, isAdmin: boolean): string {
  if (!isAdmin) return 'Sending is paused right now. Please contact your admin.';
  switch (reason) {
    case 'no_active':
      return 'No WhatsApp number is active. Open Connections, add a number and make it active.';
    case 'logged_out':
      return 'The active WhatsApp number was logged out. Sending is paused. Re-link it or activate another number on the Connections page.';
    case 'possibly_banned':
      return 'WhatsApp may have banned the active number. Sending is paused. Link a different number on the Connections page and make it active.';
    case 'linking':
      return 'The active number is waiting for its QR code to be scanned. Open Connections.';
    case 'disconnected':
      return 'The active number lost its connection and is reconnecting by itself. Sends wait until it is back.';
    case 'connecting':
      return 'The active number is starting up. Sends wait until it is connected.';
    default:
      return '';
  }
}

export const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

export const toneClasses: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
  neutral: 'bg-surface-2 text-muted',
  accent: 'bg-accent-soft text-accent',
};
