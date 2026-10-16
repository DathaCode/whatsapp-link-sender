import path from 'node:path';
import { z } from 'zod';

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const intFromEnv = (name: string, def: number, min: number, max: number) =>
  z.coerce
    .number({ error: `${name} must be a whole number` })
    .int(`${name} must be a whole number`)
    .min(min, `${name} must be at least ${min}`)
    .max(max, `${name} must be at most ${max}`)
    .default(def);

const schema = z
  .object({
    PORT: intFromEnv('PORT', 3100, 1, 65535),
    ACCESS_KEY: z
      .string({ error: 'ACCESS_KEY is missing. Set a long random password in .env' })
      .min(12, 'ACCESS_KEY must be at least 12 characters long')
      .refine((v) => !/^change-?me/i.test(v), 'ACCESS_KEY still has the example value. Pick your own secret'),
    TZ: z
      .string()
      .default('Asia/Colombo')
      .refine(isValidTimeZone, 'TZ is not a valid time zone name (example: Asia/Colombo)'),
    MIN_DELAY_SECONDS: intFromEnv('MIN_DELAY_SECONDS', 15, 5, 3600),
    MAX_DELAY_SECONDS: intFromEnv('MAX_DELAY_SECONDS', 40, 5, 3600),
    DAILY_MESSAGE_CAP: intFromEnv('DAILY_MESSAGE_CAP', 150, 1, 10000),
    SEND_WINDOW_START: z.string().default('08:00').refine((v) => HHMM.test(v), 'SEND_WINDOW_START must look like 08:00'),
    SEND_WINDOW_END: z.string().default('21:00').refine((v) => HHMM.test(v), 'SEND_WINDOW_END must look like 21:00'),
    DATA_DIR: z.string().default('./data'),
    WWEBJS_AUTH_DIR: z.string().default('./.wwebjs_auth'),
    WWEBJS_CACHE_DIR: z.string().default('./.wwebjs_cache'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    HEADLESS: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
  })
  .refine((c) => c.MAX_DELAY_SECONDS >= c.MIN_DELAY_SECONDS, {
    message: 'MAX_DELAY_SECONDS must be greater than or equal to MIN_DELAY_SECONDS',
    path: ['MAX_DELAY_SECONDS'],
  })
  .refine((c) => c.SEND_WINDOW_START !== c.SEND_WINDOW_END, {
    message: 'SEND_WINDOW_START and SEND_WINDOW_END must be different',
    path: ['SEND_WINDOW_END'],
  });

export type Config = Omit<z.infer<typeof schema>, 'DATA_DIR' | 'WWEBJS_AUTH_DIR' | 'WWEBJS_CACHE_DIR'> & {
  DATA_DIR: string;
  WWEBJS_AUTH_DIR: string;
  WWEBJS_CACHE_DIR: string;
};

/** Parses env vars; returns either a config or a list of human-readable problems. */
export function parseConfig(env: NodeJS.ProcessEnv): { ok: true; config: Config } | { ok: false; errors: string[] } {
  // Treat empty strings as "not set" so defaults apply.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ''));
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    return { ok: false, errors: result.error.issues.map((i) => `${i.path.join('.') || 'config'}: ${i.message}`) };
  }
  const c = result.data;
  return {
    ok: true,
    config: {
      ...c,
      DATA_DIR: path.resolve(c.DATA_DIR),
      WWEBJS_AUTH_DIR: path.resolve(c.WWEBJS_AUTH_DIR),
      WWEBJS_CACHE_DIR: path.resolve(c.WWEBJS_CACHE_DIR),
    },
  };
}
