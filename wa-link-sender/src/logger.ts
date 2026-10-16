import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { app: 'wa-link-sender' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: { paths: ['req.headers.cookie', 'key', 'accessKey'], remove: true },
});

export type Logger = typeof logger;
