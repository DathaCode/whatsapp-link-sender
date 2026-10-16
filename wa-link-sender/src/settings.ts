import { z } from 'zod';
import type { Config } from './config.js';
import type { Store } from './db.js';

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

/** Values from .env are the defaults; changes made on the Settings screen are stored in SQLite. */
export class Settings {
  constructor(
    private cfg: Config,
    private store: Store,
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

  get(): SafetySettings {
    const saved = this.store.getSetting<Partial<SafetySettings>>('safety') ?? {};
    const merged = { ...this.defaults(), ...saved };
    const parsed = safetySchema.safeParse(merged);
    return parsed.success ? parsed.data : this.defaults();
  }

  update(input: unknown): SafetySettings {
    const next = safetySchema.parse({ ...this.get(), ...(input as object) });
    this.store.setSetting('safety', next);
    return next;
  }

  reset(): SafetySettings {
    this.store.setSetting('safety', {});
    return this.get();
  }
}
