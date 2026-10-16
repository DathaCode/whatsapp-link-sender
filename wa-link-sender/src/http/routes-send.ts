import type { Request } from 'express';
import { z } from 'zod';
import { SESSION_COOKIE } from '../auth/sessions.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../errors.js';
import type { Job } from '../jobs.js';
import { normalizeUrl } from '../urls.js';
import { ctxOf, me, parseCookies } from './context.js';
import { route, type Deps, type RouteDef } from './app.js';

const idParam = z.coerce.number().int().positive();
const groupId = z.string().regex(/^[\w.-]+@g\.us$/, 'Only WhatsApp groups can be chosen.');

const sendBody = z.object({
  url: z.string().max(2000),
  groupIds: z.array(groupId).min(1, 'Choose at least one group.').max(1000),
  presetIds: z.array(z.number().int().positive()).max(100).default([]),
  templateId: z.number().int().positive().nullable().default(null),
  confirmDuplicate: z.boolean().default(false),
});

export function sendRoutes(d: Deps): RouteDef[] {
  const isAdmin = (req: Request) => me(req).role === 'ADMIN';

  /** What a user may send to: admins anything on the active number; users only their presets. */
  const scope = (req: Request) => {
    const u = me(req);
    const presetIds = u.role === 'ADMIN' ? null : d.users.presetIdsFor(u.id);
    return { presetIds, allowed: presetIds ? d.catalog.allowedGroupIds(presetIds) : null };
  };

  const sendingFor = (req: Request) => {
    const s = d.connections.sendingStatus();
    if (isAdmin(req) || !s.connection) return s;
    return { ...s, connection: { ...s.connection, phone: null } }; // users don't need the number
  };

  const requireJob = (req: Request): Job => {
    const job = d.jobs.get(idParam.parse(req.params.id));
    if (!job) throw notFound('That send was not found.');
    if (!isAdmin(req) && job.userId !== me(req).id) throw forbidden('You can only see and change your own sends.', 'not_owner');
    return job;
  };

  const pausedMessage = (req: Request) =>
    isAdmin(req)
      ? 'Sending is paused because the active WhatsApp number is not connected. Open Connections to fix it.'
      : 'Sending is paused right now. Please contact your admin.';

  return [
    route('get', '/api/send/options', 'user', (req, res) => {
      const { presetIds, allowed } = scope(req);
      const activeGroups = d.connections.activeGroups();
      const groups = allowed ? activeGroups.filter((g) => allowed.has(g.id)) : activeGroups;
      const available = new Set(activeGroups.filter((g) => !g.readOnly).map((g) => g.id));
      const presets = d.catalog.listPresets(presetIds ?? undefined).map((p) => ({
        id: p.id,
        name: p.name,
        groups: p.groups.map((g) => ({ ...g, available: available.has(g.id) })),
      }));
      res.json({
        isAdmin: isAdmin(req),
        presets,
        groups,
        templates: d.catalog.listTemplates(),
        settings: d.settings.get(),
        usage: d.queue.usage(),
        sending: sendingFor(req),
        queue: d.queue.getStatus(),
        timeZone: d.cfg.TZ,
      });
    }),

    route('post', '/api/links/check', 'user', (req, res) => {
      const r = normalizeUrl(req.body?.url);
      if (!r.ok) {
        res.json(r);
        return;
      }
      res.json({ ...r, previous: d.jobs.lastSendOfUrl(r.url) ?? null });
    }),

    route('post', '/api/jobs', 'user', (req, res) => {
      const ctx = ctxOf(req);
      const u = me(req);
      const blocked = (reason: string, outcome: 'failure' | 'denied' = 'failure', details: Record<string, unknown> = {}) =>
        d.audit.record(ctx, { action: 'send.blocked', outcome, reason, connectionId: d.connections.active()?.id ?? null, details });

      const parsed = sendBody.safeParse(req.body);
      if (!parsed.success) {
        blocked('invalid_request', 'failure', { problem: parsed.error.issues[0]?.message });
        throw parsed.error;
      }
      const body = parsed.data;

      const link = normalizeUrl(body.url);
      if (!link.ok) {
        blocked('invalid_url', 'failure', { url: body.url.slice(0, 300) });
        throw badRequest(link.error, 'invalid_url');
      }
      const groupIds = [...new Set(body.groupIds)];
      const presetIds = [...new Set(body.presetIds)];
      const base = { url: link.url, presetIds, groups: groupIds.length };

      // Permission: users may only use their presets and groups inside them.
      const { presetIds: allowedPresets, allowed } = scope(req);
      if (allowedPresets && allowed) {
        const badPreset = presetIds.filter((p) => !allowedPresets.includes(p));
        const badGroups = groupIds.filter((g) => !allowed.has(g));
        if (badPreset.length || badGroups.length) {
          blocked('no_permission', 'denied', { ...base, notAllowedPresets: badPreset, notAllowedGroups: badGroups.length });
          throw forbidden('You can only send to the group lists your admin gave you.', 'no_permission');
        }
      }

      const sending = d.connections.sendingStatus();
      if (!sending.accepting) {
        blocked('connection_down', 'failure', { ...base, status: sending.reason });
        throw new AppError(503, pausedMessage(req), 'sending_paused', { sending: sendingFor(req) });
      }

      if (body.templateId !== null && !d.catalog.template(body.templateId)) {
        blocked('invalid_template', 'failure', base);
        throw badRequest('That message template was deleted. Pick another one.');
      }

      const known = new Map(d.connections.activeGroups().map((g) => [g.id, g]));
      const unknown = groupIds.filter((g) => !known.has(g) || known.get(g)!.readOnly);
      if (unknown.length) {
        blocked('unknown_group', 'failure', { ...base, unavailableGroups: unknown.length });
        throw badRequest(
          `${unknown.length} chosen group(s) can't be used with the current WhatsApp number. Untick them${isAdmin(req) ? ' or refresh groups' : ''} and try again.`,
          'unknown_group',
        );
      }

      const previous = d.jobs.lastSendOfUrl(link.url);
      if (previous && !body.confirmDuplicate) {
        blocked('duplicate', 'failure', { ...base, previousJobId: previous.jobId });
        throw conflict('This link was sent before.', 'duplicate', { duplicate: previous });
      }
      if (previous) {
        d.audit.record(ctx, { action: 'send.duplicate_confirmed', targetType: 'url', targetId: link.url, details: { previousJobId: previous.jobId, previousAt: new Date(previous.at).toISOString() } });
      }

      const jobId = d.queue.enqueue({
        userId: u.id,
        url: link.url,
        platform: link.platform,
        templateId: body.templateId,
        presetIds,
        groups: groupIds.map((id) => ({ id, name: known.get(id)!.name })),
      });
      const presetNames = presetIds.length ? d.catalog.listPresets(presetIds).map((p) => p.name) : [];
      d.audit.record(ctx, {
        action: 'send.requested',
        targetType: 'job',
        targetId: jobId,
        connectionId: d.connections.active()?.id ?? null,
        details: { ...base, presetNames, templateId: body.templateId, connection: sending.connection?.label },
      });
      res.status(201).json({ job: d.jobs.get(jobId), sending: sendingFor(req) });
    }),

    route('get', '/api/jobs', 'user', (req, res) => {
      const q = z
        .object({
          search: z.string().trim().max(200).optional(),
          userId: z.coerce.number().int().positive().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(30),
          offset: z.coerce.number().int().min(0).default(0),
        })
        .parse(req.query);
      const userId = isAdmin(req) ? q.userId : me(req).id;
      res.json({ jobs: d.jobs.list({ userId, search: q.search || undefined, limit: q.limit, offset: q.offset }) });
    }),

    route('get', '/api/jobs/:id', 'user', (req, res) => {
      res.json({ job: requireJob(req) });
    }),

    route('post', '/api/jobs/:id/retry-failed', 'user', (req, res) => {
      const job = requireJob(req);
      const ctx = ctxOf(req);
      const failed = d.jobs.failedItems(job.id);
      if (!failed.length) throw badRequest('Nothing failed in this send, so there is nothing to retry.');
      const { allowed } = scope(req);
      if (allowed && failed.some((g) => !allowed.has(g.id))) {
        d.audit.record(ctx, { action: 'send.blocked', outcome: 'denied', reason: 'no_permission', details: { url: job.url, retryOf: job.id } });
        throw forbidden('Some of these groups are no longer in your group lists. Ask your admin.', 'no_permission');
      }
      const sending = d.connections.sendingStatus();
      if (!sending.accepting) {
        d.audit.record(ctx, { action: 'send.blocked', outcome: 'failure', reason: 'connection_down', details: { url: job.url, retryOf: job.id } });
        throw new AppError(503, pausedMessage(req), 'sending_paused');
      }
      const jobId = d.queue.enqueue({
        userId: me(req).id,
        url: job.url,
        platform: job.platform,
        templateId: job.templateId,
        presetIds: job.presetIds,
        parentJobId: job.id,
        groups: failed,
      });
      d.audit.record(ctx, {
        action: 'send.requested',
        targetType: 'job',
        targetId: jobId,
        connectionId: d.connections.active()?.id ?? null,
        details: { url: job.url, groups: failed.length, retryOf: job.id, presetIds: job.presetIds },
      });
      res.status(201).json({ job: d.jobs.get(jobId) });
    }),

    route('post', '/api/jobs/:id/cancel', 'user', (req, res) => {
      const job = requireJob(req);
      if (!d.queue.cancel(ctxOf(req), job.id)) throw badRequest('This send has already finished.');
      res.json({ ok: true });
    }),

    route('get', '/api/events', 'user', (req, res) => {
      const u = me(req);
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      const initial: Record<string, unknown> = { sending: sendingFor(req), queue: d.queue.getStatus(), usage: d.queue.usage() };
      if (u.role === 'ADMIN') initial.connections = d.connections.list();
      d.hub.add(res, { userId: u.id, role: u.role, stillValid: () => d.sessions.lookup(token).ok }, initial);
      req.socket.setTimeout(0);
    }),
  ];
}
