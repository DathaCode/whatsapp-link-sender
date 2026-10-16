import type { Platform, SafetySettings, WaitReason } from './types';

export const PLATFORM_NAME: Record<Platform, string> = { facebook: 'Facebook', tiktok: 'TikTok', youtube: 'YouTube' };

export function renderTemplate(body: string, url: string): string {
  return body.includes('{url}') ? body.replaceAll('{url}', url) : `${body.trim()}\n${url}`.trim();
}

/** Rough send time: pauses between groups (average) plus ~4 s per message for typing and sending. */
export function estimateSeconds(groups: number, s: SafetySettings): number {
  if (groups <= 0) return 0;
  const avgPause = (s.minDelaySeconds + s.maxDelaySeconds) / 2;
  return Math.round((groups - 1) * avgPause + groups * 4);
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} sec`;
  const min = Math.round(seconds / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
export const formatDateTime = (ms: number) => dateTime.format(new Date(ms));

export function timeAgo(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return formatDateTime(ms);
}

export function waitReasonText(reason: WaitReason, s: SafetySettings): string {
  switch (reason) {
    case 'outside_hours':
      return `Paused: outside sending hours. Sending continues at ${s.windowStart}.`;
    case 'daily_cap':
      return `Paused: today’s limit of ${s.dailyCap} messages is reached. Sending continues tomorrow.`;
    case 'whatsapp_offline':
      return 'Paused: WhatsApp is not connected. Sending continues when it reconnects.';
    default:
      return '';
  }
}

export const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
