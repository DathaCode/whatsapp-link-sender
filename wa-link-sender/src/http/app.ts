import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { ZodError } from 'zod';
import type { AuditLog } from '../audit.js';
import type { Backups } from '../backups.js';
import type { Catalog } from '../catalog.js';
import type { Composer } from '../compose.js';
import type { Drafts } from '../drafts.js';
import { MAX_IMAGE_BYTES, type Images } from '../images.js';
import { SESSION_COOKIE, CSRF_HEADER, type SessionStore } from '../auth/sessions.js';
import type { Config } from '../config.js';
import type { ConnectionManager } from '../connections.js';
import type { Db } from '../db/index.js';
import { AppError, forbidden } from '../errors.js';
import type { EventHub } from '../events.js';
import type { JobStore } from '../jobs.js';
import type { Logger } from '../logger.js';
import type { SendQueue } from '../queue.js';
import type { Settings } from '../settings.js';
import type { UserService } from '../users.js';
import { NotConnectedError } from '../whatsapp.js';
import { ctxOf, parseCookies } from './context.js';
import { adminRoutes } from './routes-admin.js';
import { authRoutes } from './routes-auth.js';
import { sendRoutes } from './routes-send.js';

export interface Deps {
  cfg: Config;
  db: Db;
  sqlite: Database.Database;
  audit: AuditLog;
  sessions: SessionStore;
  users: UserService;
  connections: ConnectionManager;
  catalog: Catalog;
  composer: Composer;
  images: Images;
  drafts: Drafts;
  settings: Settings;
  jobs: JobStore;
  queue: SendQueue;
  backups: Backups;
  hub: EventHub;
  log: Logger;
  publicDir: string;
}

/**
 * public     - anyone
 * signed_in  - any valid session, even before the forced password change
 * user       - USER or ADMIN, password already changed
 * admin      - ADMIN only
 */
export type Access = 'public' | 'signed_in' | 'user' | 'admin';
export type Method = 'get' | 'post' | 'put' | 'delete';

export interface RouteDef {
  method: Method;
  path: string;
  access: Access;
  handler: (req: Request, res: Response) => unknown;
}

export function route(method: Method, path: string, access: Access, handler: RouteDef['handler']): RouteDef {
  return { method, path, access, handler };
}

export function sessionCookieOptions(req: Request, maxAgeMs: number) {
  return { httpOnly: true, sameSite: 'strict' as const, secure: req.secure, maxAge: maxAgeMs, path: '/' };
}

export function buildRoutes(d: Deps): RouteDef[] {
  return [...authRoutes(d), ...sendRoutes(d), ...adminRoutes(d)];
}

export function createApp(d: Deps) {
  const { log, audit, sessions } = d;
  const app = express();
  const routes = buildRoutes(d);

  app.disable('x-powered-by');
  app.set('trust proxy', d.cfg.TRUST_PROXY);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: { 'img-src': ["'self'", 'data:'], 'connect-src': ["'self'"], 'upgrade-insecure-requests': null },
      },
      strictTransportSecurity: false, // set by the HTTPS proxy when there is one
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  // Image uploads arrive as the raw file (5 MB max; a little headroom so the friendly size error comes from Images).
  app.use('/api/uploads', express.raw({ type: 'application/octet-stream', limit: MAX_IMAGE_BYTES + 64 * 1024 }));

  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      if (req.path === '/healthz' || req.path === '/api/events') return;
      log.debug({ method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - start }, 'http');
    });
    next();
  });

  // Cross-site requests are blocked before anything else (the cookie is also SameSite=Strict).
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const origin = req.get('origin');
    if (origin) {
      let host = '';
      try {
        host = new URL(origin).host;
      } catch {
        /* malformed */
      }
      if (host !== req.get('host')) {
        audit.record(ctxOf(req), { action: 'access.denied', outcome: 'denied', reason: 'cross_site_request', details: { method: req.method, route: req.path, origin } });
        res.status(403).json({ error: 'This request came from another website and was blocked.', code: 'cross_site' });
        return;
      }
    }
    const rawUpload = req.path === '/uploads' && req.is('application/octet-stream');
    if (!rawUpload && req.headers['content-length'] && req.headers['content-length'] !== '0' && !req.is('application/json')) {
      res.status(415).json({ error: 'Send JSON.' });
      return;
    }
    next();
  });

  for (const def of routes) {
    app[def.method](def.path, async (req: Request, res: Response) => {
      if (def.access !== 'public') {
        const look = sessions.lookup(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
        if (!look.ok) {
          if ((look.reason === 'idle_timeout' || look.reason === 'absolute_timeout') && look.user) {
            audit.record(
              { ...ctxOf(req), actor: { userId: look.user.id, username: look.user.username, role: look.user.role }, sessionId: look.sessionId },
              { action: 'auth.session_expired', outcome: 'failure', reason: look.reason, targetType: 'session', targetId: look.sessionId },
            );
          }
          res.clearCookie(SESSION_COOKIE, { path: '/' });
          const expired = look.reason === 'idle_timeout' || look.reason === 'absolute_timeout';
          throw new AppError(401, expired ? 'Your session timed out. Please sign in again.' : 'Please sign in.', expired ? 'session_expired' : 'signed_out');
        }
        req.auth = { user: look.user, sessionId: look.sessionId, csrf: look.csrf };
        if (def.method !== 'get' && !sessions.checkCsrf(look.sessionId, req.get(CSRF_HEADER))) {
          throw forbidden('Your page is out of date. Reload it and try again.', 'csrf');
        }
        if (def.access !== 'signed_in' && look.user.mustChangePassword) {
          throw forbidden('Set a new password first.', 'password_change_required');
        }
        if (def.access === 'admin' && look.user.role !== 'ADMIN') {
          throw forbidden('Only admins can do that.', 'admin_only');
        }
      }
      await def.handler(req, res);
    });
  }

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Unknown address.' });
  });

  // ---------- web app ----------
  const indexHtml = path.join(d.publicDir, 'index.html');
  app.use(express.static(d.publicDir, { index: false, maxAge: '1h', setHeaders: cacheHeaders }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || !fs.existsSync(indexHtml)) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexHtml);
  });

  // ---------- errors ----------
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({ error: err.issues[0]?.message ?? 'Some of the values are not valid.', code: 'invalid' });
      return;
    }
    if (err instanceof AppError) {
      if (err.status === 403) {
        // Every refused request is audited, with the route and method.
        audit.record(ctxOf(req), {
          action: 'access.denied',
          outcome: 'denied',
          reason: err.code ?? 'forbidden',
          details: { method: req.method, route: req.route?.path ?? req.path, path: req.path },
        });
      }
      res.status(err.status).json({ error: err.message, code: err.code, ...err.extra });
      return;
    }
    if (err instanceof NotConnectedError) {
      res.status(503).json({ error: 'WhatsApp is not connected right now. Check the Connections page.', code: 'not_connected' });
      return;
    }
    if (err && typeof err === 'object' && (err as { type?: string }).type === 'entity.too.large') {
      res.status(413).json({ error: req.path.startsWith('/api/uploads') ? 'The image is larger than 5 MB. Use a smaller image.' : 'That request is too large.', code: 'too_large' });
      return;
    }
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({ error: 'The request was not valid JSON.' });
      return;
    }
    log.error({ err: err instanceof Error ? err.stack : String(err), path: req.path }, 'request failed');
    res.status(500).json({ error: 'Something went wrong on the server. Check the logs (docker compose logs app).' });
  });

  return { app, routes };
}

function cacheHeaders(res: Response, filePath: string) {
  if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  else if (/[\\/]assets[\\/]/.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
}
