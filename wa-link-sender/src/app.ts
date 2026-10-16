import fs from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { z, ZodError } from 'zod';
import { Auth, sameOrigin } from './auth.js';
import type { Config } from './config.js';
import { NotFoundError, type Store } from './db.js';
import type { EventHub } from './events.js';
import type { Logger } from './logger.js';
import type { SendQueue } from './queue.js';
import type { Settings } from './settings.js';
import { normalizeUrl } from './urls.js';
import { NotConnectedError, type WhatsApp } from './whatsapp.js';

export interface Deps {
  cfg: Config;
  store: Store;
  wa: WhatsApp;
  queue: SendQueue;
  settings: Settings;
  hub: EventHub;
  log: Logger;
  publicDir: string;
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const idParam = z.coerce.number().int().positive();
const groupId = z.string().regex(/^[\w.-]+@g\.us$/, 'Only WhatsApp groups can be chosen.');
const presetBody = z.object({
  name: z.string().trim().min(1, 'Give the group list a name.').max(60, 'Keep the name under 60 characters.'),
  groupIds: z.array(groupId).max(1000),
});
const templateBody = z.object({
  name: z.string().trim().min(1, 'Give the template a name.').max(60, 'Keep the name under 60 characters.'),
  body: z
    .string()
    .trim()
    .min(1, 'The message cannot be empty.')
    .max(1000, 'Keep the message under 1000 characters.')
    .refine((b) => b.includes('{url}'), 'Put {url} where the link should go.'),
  active: z.boolean().default(true),
});
const sendBody = z.object({
  url: z.string(),
  groupIds: z.array(groupId).min(1, 'Choose at least one group.').max(1000),
  templateId: z.number().int().positive().nullable().default(null),
  confirmDuplicate: z.boolean().default(false),
});

export function createApp(d: Deps) {
  const { store, wa, queue, settings, hub, log } = d;
  const auth = new Auth(d.cfg.ACCESS_KEY, store);
  const app = express();

  app.disable('x-powered-by');
  // Only trust X-Forwarded-* from the local machine / Docker network (the optional Caddy proxy).
  app.set('trust proxy', 'loopback, uniquelocal');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'img-src': ["'self'", 'data:'],
          'connect-src': ["'self'"],
          'upgrade-insecure-requests': null,
        },
      },
      strictTransportSecurity: false, // set by the HTTPS proxy when there is one
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      if (req.path === '/healthz' || req.path === '/api/events') return;
      log.debug({ method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - start }, 'http');
    });
    next();
  });

  // ---------- public ----------
  app.get('/healthz', (_req, res) => {
    const s = wa.getStatus();
    res.json({ ok: true, whatsapp: s.state, linked: s.state === 'ready', queue: queue.getStatus(), uptimeSeconds: Math.round(process.uptime()) });
  });

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) =>
      res.status(429).json({ error: 'Too many wrong attempts. Wait 15 minutes, then try again.' }),
  });

  app.use('/api', sameOrigin);

  app.post('/api/login', loginLimiter, (req, res) => {
    if (!auth.checkKey(req.body?.key)) {
      log.warn({ ip: req.ip }, 'failed login');
      res.status(401).json({ error: 'That access key is not right. Check the ACCESS_KEY value in the .env file.' });
      return;
    }
    auth.login(req, res);
    log.info({ ip: req.ip }, 'signed in');
    res.json({ ok: true });
  });
  app.post('/api/logout', (req, res) => {
    auth.logout(req, res);
    res.json({ ok: true });
  });
  app.get('/api/session', (req, res) => {
    res.json({ signedIn: auth.isSignedIn(req) });
  });

  // ---------- everything below needs a session ----------
  const api = express.Router();
  api.use(auth.require);

  const snapshot = () => ({
    whatsapp: wa.getStatus(),
    queue: queue.getStatus(),
    usage: queue.usage(),
    settings: settings.get(),
    timeZone: d.cfg.TZ,
  });

  api.get('/bootstrap', (_req, res) => {
    res.json({
      ...snapshot(),
      defaults: settings.defaults(),
      groups: store.listGroups(),
      presets: store.listPresets(),
      templates: store.listTemplates(),
      activeJobs: store.activeJobs().map((j) => store.getJob(j.id)),
    });
  });

  api.get('/events', (req, res) => {
    const s = snapshot();
    hub.add(res, { whatsapp: s.whatsapp, queue: s.queue, usage: s.usage });
    req.socket.setTimeout(0);
  });

  // ---------- WhatsApp ----------
  api.post('/whatsapp/unlink', async (_req, res) => {
    log.warn('unlink requested from the web page');
    await wa.logout();
    res.json({ ok: true });
  });

  api.post('/groups/refresh', async (_req, res) => {
    let groups;
    try {
      groups = await wa.listGroups();
    } catch (e) {
      if (e instanceof NotConnectedError) throw e;
      log.error({ err: e instanceof Error ? e.message : String(e) }, 'group refresh failed');
      throw new HttpError(502, 'WhatsApp did not return your groups. Wait a minute and press “Refresh groups” again. If it keeps failing, restart the app (docker compose restart app).');
    }
    store.replaceGroups(groups);
    hub.emit('groups', groups);
    log.info({ count: groups.length }, 'groups refreshed');
    res.json({ groups });
  });

  // ---------- presets ----------
  api.post('/presets', (req, res) => {
    const id = store.upsertPreset(presetBody.parse(req.body));
    res.status(201).json({ id, presets: store.listPresets() });
  });
  api.put('/presets/:id', (req, res) => {
    store.upsertPreset({ ...presetBody.parse(req.body), id: idParam.parse(req.params.id) });
    res.json({ presets: store.listPresets() });
  });
  api.delete('/presets/:id', (req, res) => {
    store.deletePreset(idParam.parse(req.params.id));
    res.json({ presets: store.listPresets() });
  });

  // ---------- templates ----------
  api.post('/templates', (req, res) => {
    const id = store.upsertTemplate(templateBody.parse(req.body));
    res.status(201).json({ id, templates: store.listTemplates() });
  });
  api.put('/templates/:id', (req, res) => {
    store.upsertTemplate({ ...templateBody.parse(req.body), id: idParam.parse(req.params.id) });
    res.json({ templates: store.listTemplates() });
  });
  api.delete('/templates/:id', (req, res) => {
    if (store.listTemplates().length <= 1) throw new HttpError(400, 'Keep at least one message template.');
    store.deleteTemplate(idParam.parse(req.params.id));
    res.json({ templates: store.listTemplates() });
  });

  // ---------- safety settings ----------
  api.put('/settings', (req, res) => {
    const next = settings.update(req.body);
    log.info({ settings: next }, 'safety settings changed');
    queue.kick();
    hub.emit('usage', queue.usage());
    res.json({ settings: next });
  });
  api.post('/settings/reset', (_req, res) => {
    const next = settings.reset();
    queue.kick();
    hub.emit('usage', queue.usage());
    res.json({ settings: next });
  });

  // ---------- links & sending ----------
  api.post('/links/check', (req, res) => {
    const r = normalizeUrl(req.body?.url);
    if (!r.ok) {
      res.json(r);
      return;
    }
    res.json({ ...r, previous: store.lastSendOfUrl(r.url) ?? null });
  });

  api.post('/jobs', (req, res) => {
    const body = sendBody.parse(req.body);
    const link = normalizeUrl(body.url);
    if (!link.ok) throw new HttpError(400, link.error);

    if (body.templateId !== null && !store.getTemplate(body.templateId)) {
      throw new HttpError(400, 'That message template was deleted. Pick another one.');
    }

    const ids = [...new Set(body.groupIds)];
    const known = store.groupNames(ids);
    const unknown = ids.filter((id) => !known.has(id));
    if (unknown.length) {
      throw new HttpError(400, `${unknown.length} chosen group(s) are no longer in your list. Press “Refresh groups” and choose again.`);
    }

    const previous = store.lastSendOfUrl(link.url);
    if (previous && !body.confirmDuplicate) {
      throw new HttpError(409, 'This link was sent before.', { duplicate: previous });
    }

    const jobId = queue.enqueue({
      url: link.url,
      platform: link.platform,
      templateId: body.templateId,
      groups: ids.map((id) => ({ id, name: known.get(id)! })),
    });
    res.status(201).json({ job: store.getJob(jobId) });
  });

  api.get('/jobs', (req, res) => {
    const q = z
      .object({
        search: z.string().trim().max(200).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(30),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .parse(req.query);
    res.json({ jobs: store.listJobs({ search: q.search || undefined, limit: q.limit, offset: q.offset }) });
  });

  api.get('/jobs/:id', (req, res) => {
    const job = store.getJob(idParam.parse(req.params.id));
    if (!job) throw new NotFoundError('That send was not found.');
    res.json({ job });
  });

  api.post('/jobs/:id/retry-failed', (req, res) => {
    const job = store.getJob(idParam.parse(req.params.id));
    if (!job) throw new NotFoundError('That send was not found.');
    const failed = store.failedItems(job.id);
    if (!failed.length) throw new HttpError(400, 'Nothing failed in this send, so there is nothing to retry.');
    const jobId = queue.enqueue({
      url: job.url,
      platform: job.platform,
      templateId: job.templateId,
      parentJobId: job.id,
      groups: failed,
    });
    res.status(201).json({ job: store.getJob(jobId) });
  });

  api.post('/jobs/:id/cancel', (req, res) => {
    if (!queue.cancel(idParam.parse(req.params.id))) throw new HttpError(400, 'This send has already finished.');
    res.json({ ok: true });
  });

  app.use('/api', api);
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Unknown address.' });
  });

  // ---------- web app ----------
  const indexHtml = path.join(d.publicDir, 'index.html');
  app.use(express.static(d.publicDir, { index: false, maxAge: '1h', setHeaders: noCacheHtml }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || !fs.existsSync(indexHtml)) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexHtml);
  });

  // ---------- errors ----------
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({ error: err.issues[0]?.message ?? 'Some of the values are not valid.' });
      return;
    }
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, ...err.extra });
      return;
    }
    if (err instanceof NotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof NotConnectedError) {
      res.status(503).json({ error: 'WhatsApp is not connected yet. Open the Connection tab and link your phone.' });
      return;
    }
    if (err instanceof Error && /UNIQUE constraint failed: presets\.name/.test(err.message)) {
      res.status(409).json({ error: 'A group list with that name already exists. Pick another name.' });
      return;
    }
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({ error: 'The request was not valid JSON.' });
      return;
    }
    log.error({ err: err instanceof Error ? err.stack : String(err), path: req.path }, 'request failed');
    res.status(500).json({ error: 'Something went wrong on the server. Check the logs (docker compose logs).' });
  });

  return app;
}

function noCacheHtml(res: Response, filePath: string) {
  if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  else if (/[\\/]assets[\\/]/.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
}
