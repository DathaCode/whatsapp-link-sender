import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { diff, type AuditContext, type AuditLog } from './audit.js';
import type { Config } from './config.js';
import type { Db } from './db/index.js';
import { settings } from './db/schema.js';

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const safetySchema = z
  .object({
    minDelaySeconds: z.number().int().min(5, 'The shortest pause must be at least 5 seconds').max(3600),
    maxDelaySeconds: z.number().int().min(5).max(3600, 'The longest pause can be at most 1 hour'),
    dailyCap: z.number().int().min(1, 'The daily limit must be at least 1').max(10000),
    windowStart: z.string().regex(HHMM, 'Use a time like 08:00'),
    windowEnd: z.string().regex(HHMM, 'Use a time like 21:00'),
  })
  .refine((s) => s.maxDelaySeconds >= s.minDelaySeconds, {
    message: 'The longest pause must be the same as or longer than the shortest pause',
    path: ['maxDelaySeconds'],
  })
  .refine((s) => s.windowStart !== s.windowEnd, {
    message: 'Start and end of sending hours must be different',
    path: ['windowEnd'],
  });

export type SafetySettings = z.infer<typeof safetySchema>;
const KEY = 'safety';

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
      dailyCap: this.cfg.DAILY_MESSAGE_CAP,
      windowStart: this.cfg.SEND_WINDOW_START,
      windowEnd: this.cfg.SEND_WINDOW_END,
    };
  }

  private saved(): Partial<SafetySettings> {
    const row = this.db.select().from(settings).where(eq(settings.key, KEY)).get();
    return row ? (JSON.parse(row.value) as Partial<SafetySettings>) : {};
  }

  get(): SafetySettings {
    const parsed = safetySchema.safeParse({ ...this.defaults(), ...this.saved() });
    return parsed.success ? parsed.data : this.defaults();
  }

  private write(value: Partial<SafetySettings>) {
    this.db
      .insert(settings)
      .values({ key: KEY, value: JSON.stringify(value) })
      .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(value) } })
      .run();
  }

  update(ctx: AuditContext, input: unknown): SafetySettings {
    const before = this.get();
    const next = safetySchema.parse({ ...before, ...(input as object) });
    const changes = diff(before, next);
    if (!Object.keys(changes).length) return before;
    this.write(next);
    this.audit.record(ctx, { action: 'settings.updated', targetType: 'settings', targetId: KEY, details: { changes } });
    return next;
  }

  reset(ctx: AuditContext): SafetySettings {
    const before = this.get();
    this.write({});
    const after = this.get();
    this.audit.record(ctx, {
      action: 'settings.updated',
      targetType: 'settings',
      targetId: KEY,
      reason: 'reset to .env defaults',
      details: { changes: diff(before, after) },
    });
    return after;
  }
}
