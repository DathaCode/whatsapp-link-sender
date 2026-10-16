import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { diff, type AuditContext, type AuditLog } from './audit.js';
import type { Config } from './config.js';
import type { Db } from './db/index.js';
import { settings } from './db/schema.js';
import { DEFAULT_ALLOWED_DOMAINS, DEFAULT_REPEATING_LINKS, normalizeDomain } from './message.js';

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const safetySchema = z
  .object({
    minDelaySeconds: z.number().int().min(5, 'The shortest pause must be at least 5 seconds').max(3600),
    maxDelaySeconds: z.number().int().min(5).max(3600, 'The longest pause can be at most 1 hour'),
    /** Separate (longer) pause for sends that include an image. */
    imageMinDelaySeconds: z.number().int().min(5, 'The shortest image pause must be at least 5 seconds').max(3600),
    imageMaxDelaySeconds: z.number().int().min(5).max(3600, 'The longest image pause can be at most 1 hour'),
    /** single = image with the text as caption; two = image, then the text (keeps the link preview card). */
    imageSendMode: z.enum(['single', 'two']),
    dailyCap: z.number().int().min(1, 'The daily limit must be at least 1').max(10000),
    windowStart: z.string().regex(HHMM, 'Use a time like 08:00'),
    windowEnd: z.string().regex(HHMM, 'Use a time like 21:00'),
  })
  .refine((s) => s.maxDelaySeconds >= s.minDelaySeconds, {
    message: 'The longest pause must be the same as or longer than the shortest pause',
    path: ['maxDelaySeconds'],
  })
  .refine((s) => s.imageMaxDelaySeconds >= s.imageMinDelaySeconds, {
    message: 'The longest image pause must be the same as or longer than the shortest image pause',
    path: ['imageMaxDelaySeconds'],
  })
  .refine((s) => s.windowStart !== s.windowEnd, {
    message: 'Start and end of sending hours must be different',
    path: ['windowEnd'],
  });

export type SafetySettings = z.infer<typeof safetySchema>;

const domainList = z
  .array(z.string().max(253))
  .max(200)
  .transform((list) => [...new Set(list.map(normalizeDomain).filter(Boolean))])
  .refine((list) => list.every((d) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)), 'Each domain should look like hiru.lk or youtube.com');

const linkList = z
  .array(z.string().max(2000))
  .max(200)
  .transform((list) => [...new Set(list.map((l) => l.trim()).filter(Boolean))]);

export const messagingSchema = z.object({
  /** Users may only send links to these domains (and their subdomains). */
  allowedDomains: domainList,
  /** Links that appear in every post (profile links etc.) and never count for duplicate detection. */
  repeatingLinks: linkList,
});
export type MessagingSettings = z.infer<typeof messagingSchema>;

const SAFETY = 'safety';
const MESSAGING = 'messaging';

/** Values from .env are the defaults; changes made on the Settings page are stored in the database. */
export class Settings {
  constructor(
    private cfg: Config,
    private db: Db,
    private audit: AuditLog,
  ) {}

  defaults(): SafetySettings {
    return {
      minDelaySeconds: this.cfg.MIN_DELAY_SECONDS,
      maxDelaySeconds: this.cfg.MAX_DELAY_SECONDS,
      imageMinDelaySeconds: 30,
      imageMaxDelaySeconds: 90,
      imageSendMode: 'single',
      dailyCap: this.cfg.DAILY_MESSAGE_CAP,
      windowStart: this.cfg.SEND_WINDOW_START,
      windowEnd: this.cfg.SEND_WINDOW_END,
    };
  }

  private read<T>(key: string): Partial<T> {
    const row = this.db.select().from(settings).where(eq(settings.key, key)).get();
    return row ? (JSON.parse(row.value) as Partial<T>) : {};
  }

  private write(key: string, value: unknown) {
    this.db
      .insert(settings)
      .values({ key, value: JSON.stringify(value) })
      .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(value) } })
      .run();
  }

  get(): SafetySettings {
    const parsed = safetySchema.safeParse({ ...this.defaults(), ...this.read<SafetySettings>(SAFETY) });
    return parsed.success ? parsed.data : this.defaults();
  }

  update(ctx: AuditContext, input: unknown): SafetySettings {
    const before = this.get();
    const next = safetySchema.parse({ ...before, ...(input as object) });
    const changes = diff(before, next);
    if (!Object.keys(changes).length) return before;
    this.write(SAFETY, next);
    this.audit.record(ctx, { action: 'settings.updated', targetType: 'settings', targetId: SAFETY, details: { changes } });
    return next;
  }

  reset(ctx: AuditContext): SafetySettings {
    const before = this.get();
    this.write(SAFETY, {});
    const after = this.get();
    this.audit.record(ctx, {
      action: 'settings.updated',
      targetType: 'settings',
      targetId: SAFETY,
      reason: 'reset to .env defaults',
      details: { changes: diff(before, after) },
    });
    return after;
  }

  messagingDefaults(): MessagingSettings {
    return { allowedDomains: [...DEFAULT_ALLOWED_DOMAINS], repeatingLinks: [...DEFAULT_REPEATING_LINKS] };
  }

  messaging(): MessagingSettings {
    const parsed = messagingSchema.safeParse({ ...this.messagingDefaults(), ...this.read<MessagingSettings>(MESSAGING) });
    return parsed.success ? parsed.data : this.messagingDefaults();
  }

  updateMessaging(ctx: AuditContext, input: unknown): MessagingSettings {
    const before = this.messaging();
    const next = messagingSchema.parse({ ...before, ...(input as object) });
    const changes = diff(before, next);
    if (!Object.keys(changes).length) return before;
    this.write(MESSAGING, next);
    this.audit.record(ctx, { action: 'settings.updated', targetType: 'settings', targetId: MESSAGING, details: { changes } });
    return next;
  }
}
