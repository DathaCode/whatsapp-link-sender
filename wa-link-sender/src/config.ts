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

const numFromEnv = (name: string, def: number, min: number, max: number) =>
  z.coerce
    .number({ error: `${name} must be a number` })
    .min(min, `${name} must be at least ${min}`)
    .max(max, `${name} must be at most ${max}`)
    .default(def);

/**
 * TRUST_PROXY follows Express's "trust proxy" setting:
 *   false / true, a hop count ("1"), or a comma list of addresses/presets
 *   ("loopback, uniquelocal" = the local machine and private Docker networks).
 */
function parseTrustProxy(v: string): boolean | number | string {
  const s = v.trim().toLowerCase();
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^\d+$/.test(s)) return Number(s);
  return v.trim();
}

const schema = z
  .object({
    PORT: intFromEnv('PORT', 3100, 1, 65535),
    TZ: z
      .string()
      .default('Asia/Colombo')
      .refine(isValidTimeZone, 'TZ is not a valid time zone name (example: Asia/Colombo)'),

    // ---- accounts & sessions ----
    INITIAL_ADMIN_USERNAME: z
      .string()
      .regex(/^[a-zA-Z0-9._-]{3,32}$/, 'INITIAL_ADMIN_USERNAME must be 3-32 letters, digits, dots, dashes or underscores')
      .optional(),
    INITIAL_ADMIN_PASSWORD: z.string().min(10, 'INITIAL_ADMIN_PASSWORD must be at least 10 characters').optional(),
    SESSION_SECRET: z
      .string({ error: 'SESSION_SECRET is missing. Set a long random value in .env (see .env.example)' })
      .min(32, 'SESSION_SECRET must be at least 32 characters')
      .refine((v) => !/^change-?me/i.test(v), 'SESSION_SECRET still has the example value'),
    SESSION_IDLE_HOURS: numFromEnv('SESSION_IDLE_HOURS', 8, 0.25, 24 * 30),
    SESSION_MAX_DAYS: numFromEnv('SESSION_MAX_DAYS', 7, 0.1, 365),
    LOGIN_MAX_ATTEMPTS: intFromEnv('LOGIN_MAX_ATTEMPTS', 5, 1, 100),
    LOGIN_LOCK_MINUTES: intFromEnv('LOGIN_LOCK_MINUTES', 15, 1, 24 * 60),
    TRUST_PROXY: z.string().default('loopback, uniquelocal').transform(parseTrustProxy),

    // ---- audit & backups ----
    AUDIT_RETENTION_DAYS: intFromEnv('AUDIT_RETENTION_DAYS', 365, 30, 3650),
    BACKUP_KEEP: intFromEnv('BACKUP_KEEP', 14, 1, 365),
    /** Attached images are deleted after this many days (history then shows "image expired"). */
    UPLOAD_RETENTION_DAYS: intFromEnv('UPLOAD_RETENTION_DAYS', 90, 1, 3650),

    // ---- sending safety defaults (Settings page can override) ----
    MIN_DELAY_SECONDS: intFromEnv('MIN_DELAY_SECONDS', 15, 5, 3600),
    MAX_DELAY_SECONDS: intFromEnv('MAX_DELAY_SECONDS', 40, 5, 3600),
    DAILY_MESSAGE_CAP: intFromEnv('DAILY_MESSAGE_CAP', 150, 1, 10000),
    SEND_WINDOW_START: z.string().default('08:00').refine((v) => HHMM.test(v), 'SEND_WINDOW_START must look like 08:00'),
    SEND_WINDOW_END: z.string().default('21:00').refine((v) => HHMM.test(v), 'SEND_WINDOW_END must look like 21:00'),

    // ---- paths & runtime ----
    DATA_DIR: z.string().default('./data'),
    WWEBJS_AUTH_DIR: z.string().default('./.wwebjs_auth'),
    WWEBJS_CACHE_DIR: z.string().default('./.wwebjs_cache'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
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

export type Config = z.infer<typeof schema>;

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
