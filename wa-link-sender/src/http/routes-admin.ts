import fs from 'node:fs';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { toCsvRow, type AuditFilters } from '../audit.js';
import { auditLog, jobs, OUTCOMES, ROLES, users } from '../db/schema.js';
import { localTime } from '../time.js';
import { ctxOf, me } from './context.js';
import { route, type Deps, type RouteDef } from './app.js';

const idParam = z.coerce.number().int().positive();
const groupRef = z.object({
  id: z.string().regex(/^[\w.-]+@g\.us$/, 'Only WhatsApp groups can be added.'),
  name: z.string().trim().min(1).max(200),
});
const presetBody = z.object({
  name: z.string().trim().min(1, 'Give the preset a name.').max(60, 'Keep the name under 60 characters.'),
  groups: z.array(groupRef).max(1000),
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

export const AUDIT_CATEGORIES = ['auth', 'access', 'user', 'connection', 'group', 'preset', 'template', 'settings', 'send', 'system'] as const;

const auditQuery = z.object({
  from: z.coerce.number().int().optional(),
  to: z.coerce.number().int().optional(),
  userId: z.coerce.number().int().optional(),
  category: z.enum(AUDIT_CATEGORIES).optional(),
  outcome: z.enum(OUTCOMES).optional(),
  connectionId: z.coerce.number().int().optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export function adminRoutes(d: Deps): RouteDef[] {
  const { users: userSvc, connections, catalog, audit } = d;

  const filtersOf = (q: z.infer<typeof auditQuery>): AuditFilters => ({
    from: q.from,
    to: q.to,
    userId: q.userId,
    category: q.category,
    outcome: q.outcome,
    connectionId: q.connectionId,
    q: q.q || undefined,
  });

  return [
    // ---------------- dashboard ----------------
    route('get', '/api/admin/dashboard', 'admin', (_req, res) => {
      const today = localTime(new Date(), d.cfg.TZ).day;
      const dayStart = Date.now() - 36 * 3_600_000; // generous window, filtered by local day below
      const recentLogins = d.db
        .select({
          ts: auditLog.ts,
          username: auditLog.actorUsername,
          outcome: auditLog.outcome,
          reason: auditLog.reason,
          ip: auditLog.ip,
        })
        .from(auditLog)
        .where(inArray(auditLog.action, ['auth.login', 'auth.lockout']))
        .orderBy(desc(auditLog.id))
        .limit(10)
        .all();
      const jobsToday = d.db
        .select({ createdAt: jobs.createdAt })
        .from(jobs)
        .where(gte(jobs.createdAt, dayStart))
        .all()
        .filter((j) => localTime(new Date(j.createdAt), d.cfg.TZ).day === today).length;
      const deniedToday = d.db
        .select({ n: sql<number>`count(*)` })
        .from(auditLog)
        .where(and(eq(auditLog.outcome, 'denied'), gte(auditLog.ts, Date.now() - 86_400_000)))
        .get();
      res.json({
        sending: connections.sendingStatus(),
        connections: connections.list().filter((c) => c.status !== 'retired'),
        usage: d.queue.usage(),
        settings: d.settings.get(),
        queue: d.queue.getStatus(),
        activeJobs: d.jobs.active(),
        recentFailures: d.jobs.recentFailures(10),
        recentLogins,
        counts: {
          users: d.db.select({ n: sql<number>`count(*)` }).from(users).where(eq(users.disabled, false)).get()?.n ?? 0,
          jobsToday,
          deniedLast24h: Number(deniedToday?.n) || 0,
        },
        timeZone: d.cfg.TZ,
      });
    }),

    // ---------------- users ----------------
    route('get', '/api/admin/users', 'admin', (_req, res) => {
      res.json({ users: userSvc.list() });
    }),
    route('post', '/api/admin/users', 'admin', async (req, res) => {
      const body = z
        .object({
          username: z.string().trim().max(32),
          displayName: z.string().trim().max(80).default(''),
          role: z.enum(ROLES),
          password: z.string().max(200).optional(),
          presetIds: z.array(z.number().int().positive()).max(100).default([]),
        })
        .parse(req.body);
      const ctx = ctxOf(req);
      const r = await userSvc.create(ctx, body);
      const user = body.presetIds.length ? userSvc.setPresetAccess(ctx, r.user.id, body.presetIds) : r.user;
      res.status(201).json({ user, temporaryPassword: r.temporaryPassword });
    }),
    route('put', '/api/admin/users/:id', 'admin', (req, res) => {
      const body = z.object({ displayName: z.string().trim().max(80).optional(), role: z.enum(ROLES).optional() }).parse(req.body);
      const id = idParam.parse(req.params.id);
      const user = userSvc.update(ctxOf(req), id, body);
      if (body.role) d.hub.disconnectUser(id);
      res.json({ user });
    }),
    route('post', '/api/admin/users/:id/disable', 'admin', (req, res) => {
      const id = idParam.parse(req.params.id);
      const user = userSvc.setDisabled(ctxOf(req), id, true);
      d.hub.disconnectUser(id);
      res.json({ user });
    }),
    route('post', '/api/admin/users/:id/enable', 'admin', (req, res) => {
      res.json({ user: userSvc.setDisabled(ctxOf(req), idParam.parse(req.params.id), false) });
    }),
    route('post', '/api/admin/users/:id/reset-password', 'admin', async (req, res) => {
      const id = idParam.parse(req.params.id);
      const temporaryPassword = await userSvc.resetPassword(ctxOf(req), id);
      d.hub.disconnectUser(id);
      res.json({ user: userSvc.view(id), temporaryPassword });
    }),
    route('post', '/api/admin/users/:id/sign-out', 'admin', (req, res) => {
      const id = idParam.parse(req.params.id);
      const ended = userSvc.forceSignOut(ctxOf(req), id);
      d.hub.disconnectUser(id);
      res.json({ user: userSvc.view(id), sessionsEnded: ended });
    }),
    route('put', '/api/admin/users/:id/presets', 'admin', (req, res) => {
      const body = z.object({ presetIds: z.array(z.number().int().positive()).max(100) }).parse(req.body);
      res.json({ user: userSvc.setPresetAccess(ctxOf(req), idParam.parse(req.params.id), body.presetIds) });
    }),

    // ---------------- WhatsApp connections ----------------
    route('get', '/api/admin/connections', 'admin', (_req, res) => {
      res.json({ connections: connections.list(), sending: connections.sendingStatus() });
    }),
    route('post', '/api/admin/connections', 'admin', (req, res) => {
      const body = z.object({ label: z.string().trim().max(60).default('') }).parse(req.body);
      const rec = connections.add(ctxOf(req), body.label);
      res.status(201).json({ connection: connections.list().find((c) => c.id === rec.id) });
    }),
    route('post', '/api/admin/connections/:id/activate', 'admin', async (req, res) => {
      await connections.activate(ctxOf(req), idParam.parse(req.params.id));
      d.queue.kick();
      res.json({ connections: connections.list() });
    }),
    route('post', '/api/admin/connections/:id/relink', 'admin', async (req, res) => {
      await connections.relink(ctxOf(req), idParam.parse(req.params.id));
      res.json({ connections: connections.list() });
    }),
    route('post', '/api/admin/connections/:id/cancel-link', 'admin', async (req, res) => {
      await connections.cancelLink(ctxOf(req), idParam.parse(req.params.id));
      res.json({ connections: connections.list() });
    }),
    route('delete', '/api/admin/connections/:id', 'admin', async (req, res) => {
      await connections.remove(ctxOf(req), idParam.parse(req.params.id));
      d.queue.kick();
      res.json({ connections: connections.list() });
    }),

    // ---------------- groups & presets ----------------
    route('get', '/api/admin/groups', 'admin', (_req, res) => {
      const active = connections.active();
      res.json({ connectionId: active?.id ?? null, groups: connections.activeGroups() });
    }),
    route('post', '/api/admin/groups/refresh', 'admin', async (req, res) => {
      const groups = await connections.refreshGroups(ctxOf(req));
      res.json({ connectionId: connections.active()?.id ?? null, groups });
    }),
    route('post', '/api/admin/groups/debug', 'admin', async (req, res) => {
      res.json(await connections.debugGroups(ctxOf(req)));
    }),
    route('get', '/api/admin/presets', 'admin', (_req, res) => {
      res.json({ presets: catalog.listPresets() });
    }),
    route('post', '/api/admin/presets', 'admin', (req, res) => {
      res.status(201).json({ preset: catalog.createPreset(ctxOf(req), presetBody.parse(req.body)) });
    }),
    route('put', '/api/admin/presets/:id', 'admin', (req, res) => {
      res.json({ preset: catalog.updatePreset(ctxOf(req), idParam.parse(req.params.id), presetBody.parse(req.body)) });
    }),
    route('delete', '/api/admin/presets/:id', 'admin', (req, res) => {
      catalog.deletePreset(ctxOf(req), idParam.parse(req.params.id));
      res.json({ presets: catalog.listPresets() });
    }),

    // ---------------- templates ----------------
    route('get', '/api/admin/templates', 'admin', (_req, res) => {
      res.json({ templates: catalog.listTemplates() });
    }),
    route('post', '/api/admin/templates', 'admin', (req, res) => {
      res.status(201).json({ templates: catalog.createTemplate(ctxOf(req), templateBody.parse(req.body)) });
    }),
    route('put', '/api/admin/templates/:id', 'admin', (req, res) => {
      res.json({ templates: catalog.updateTemplate(ctxOf(req), idParam.parse(req.params.id), templateBody.parse(req.body)) });
    }),
    route('delete', '/api/admin/templates/:id', 'admin', (req, res) => {
      res.json({ templates: catalog.deleteTemplate(ctxOf(req), idParam.parse(req.params.id)) });
    }),

    // ---------------- settings ----------------
    route('get', '/api/admin/settings', 'admin', (_req, res) => {
      res.json({ settings: d.settings.get(), defaults: d.settings.defaults(), timeZone: d.cfg.TZ, auditRetentionDays: d.cfg.AUDIT_RETENTION_DAYS, backupKeep: d.cfg.BACKUP_KEEP });
    }),
    route('put', '/api/admin/settings', 'admin', (req, res) => {
      const settings = d.settings.update(ctxOf(req), req.body);
      d.queue.kick();
      d.hub.all('usage', d.queue.usage());
      res.json({ settings });
    }),
    route('post', '/api/admin/settings/reset', 'admin', (req, res) => {
      const settings = d.settings.reset(ctxOf(req));
      d.queue.kick();
      d.hub.all('usage', d.queue.usage());
      res.json({ settings });
    }),

    // ---------------- audit log ----------------
    route('get', '/api/admin/audit', 'admin', (req, res) => {
      const q = auditQuery.parse(req.query);
      const { rows, total } = audit.query(filtersOf(q), { limit: q.limit, offset: q.offset });
      res.json({ rows, total, timeZone: d.cfg.TZ });
    }),
    route('get', '/api/admin/audit/meta', 'admin', (_req, res) => {
      res.json({
        categories: AUDIT_CATEGORIES,
        outcomes: OUTCOMES,
        users: d.db.select({ id: users.id, username: users.username }).from(users).orderBy(users.username).all(),
        connections: connections.list().map((c) => ({ id: c.id, label: c.label, phone: c.phone, status: c.status })),
        timeZone: d.cfg.TZ,
        retentionDays: d.cfg.AUDIT_RETENTION_DAYS,
      });
    }),
    route('get', '/api/admin/audit/export', 'admin', (req, res) => {
      const q = auditQuery.parse(req.query);
      const filters = filtersOf(q);
      const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone: d.cfg.TZ, dateStyle: 'short', timeStyle: 'medium' });
      const name = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
      res.write('﻿'); // Excel-friendly UTF-8
      res.write(
        toCsvRow(['id', 'time_utc', `time_${d.cfg.TZ}`, 'actor', 'role', 'ip', 'user_agent', 'session_id', 'action', 'outcome', 'target_type', 'target_id', 'connection_id', 'reason', 'details']),
      );
      let n = 0;
      for (const r of audit.iterate(filters)) {
        res.write(
          toCsvRow([r.id, new Date(r.ts).toISOString(), fmt.format(new Date(r.ts)), r.actorUsername, r.actorRole, r.ip, r.userAgent, r.sessionId, r.action, r.outcome, r.targetType, r.targetId, r.connectionId, r.reason, r.details]),
        );
        n++;
      }
      // The export itself is recorded (after counting rows, so it isn't included in its own file).
      audit.record(ctxOf(req), { action: 'system.audit_exported', details: { rows: n, filters } });
      res.end();
    }),

    // ---------------- backups ----------------
    route('get', '/api/admin/backups', 'admin', (_req, res) => {
      res.json({ backups: d.backups.list(), keep: d.cfg.BACKUP_KEEP });
    }),
    route('post', '/api/admin/backups', 'admin', (req, res) => {
      const b = d.backups.create(ctxOf(req), 'manual');
      res.status(201).json({ backup: b, backups: d.backups.list() });
    }),
    route('get', '/api/admin/backups/:name/download', 'admin', (req, res) => {
      const name = z.string().max(100).parse(req.params.name);
      const file = d.backups.pathFor(name);
      audit.record(ctxOf(req), { action: 'system.backup_downloaded', targetType: 'backup', targetId: name, details: { size: fs.statSync(file).size, by: me(req).username } });
      res.download(file, name);
    }),
  ];
}
