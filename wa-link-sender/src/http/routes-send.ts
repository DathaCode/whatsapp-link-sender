import fs from 'node:fs';
import type { Request } from 'express';
import { z } from 'zod';
import { SESSION_COOKIE } from '../auth/sessions.js';
import { imageInfo } from '../compose.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../errors.js';
import type { Job } from '../jobs.js';
import { CAPTION_MAX, TEXT_MAX, cleanMessage, mainLinks, normalizeMessage, sha256, textKey } from '../message.js';
import { ctxOf, me, parseCookies } from './context.js';
import { route, type Deps, type RouteDef } from './app.js';

const idParam = z.coerce.number().int().positive();
const groupId = z.string().regex(/^[\w.-]+@g\.us$/, 'Only WhatsApp groups can be chosen.');
const uploadId = z.string().regex(/^[a-f0-9]{32}$/);

const sendBody = z.object({
  text: z.string().max(TEXT_MAX * 4),
  uploadId: uploadId.nullable().default(null),
  groupIds: z.array(groupId).min(1, 'Choose at least one group.').max(1000),
  presetIds: z.array(z.number().int().positive()).max(100).default([]),
  confirmDuplicate: z.boolean().default(false),
  /** Admins only: send although some links are outside the allowed domains. */
  confirmLinks: z.boolean().default(false),
});

export function sendRoutes(d: Deps): RouteDef[] {
  const isAdmin = (req: Request) => me(req).role === 'ADMIN';
  const userOf = (req: Request) => ({ id: me(req).id, isAdmin: isAdmin(req) });

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

  /** Analysis as returned to the browser (no file paths). */
  const publicAnalysis = (a: ReturnType<Deps['composer']['analyze']>) => ({ ...a, image: imageInfo(a.image) });

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
        snippets: d.catalog.listSnippets(),
        allowedDomains: d.settings.messaging().allowedDomains,
        limits: { text: TEXT_MAX, caption: CAPTION_MAX, imageBytes: 5 * 1024 * 1024 },
        settings: d.settings.get(),
        usage: d.queue.usage(),
        sending: sendingFor(req),
        queue: d.queue.getStatus(),
        timeZone: d.cfg.TZ,
      });
    }),

    /** Live preview: exactly what would be sent, with every check. Nothing is logged. */
    route('post', '/api/messages/check', 'user', (req, res) => {
      const body = z.object({ text: z.string().max(TEXT_MAX * 4), uploadId: uploadId.nullable().default(null) }).parse(req.body);
      res.json(publicAnalysis(d.composer.analyze(body, userOf(req))));
    }),

    // ---------------- drafts ----------------
    route('get', '/api/drafts', 'user', (req, res) => {
      const draft = d.drafts.get(me(req).id);
      let image = null;
      if (draft.uploadId) {
        try {
          image = imageInfo(d.images.usable(draft.uploadId, me(req).id, isAdmin(req)));
        } catch {
          image = null; // expired: the draft just loses its image
        }
      }
      res.json({ draft: { ...draft, uploadId: image ? draft.uploadId : null }, image });
    }),
    route('put', '/api/drafts', 'user', (req, res) => {
      const body = z.object({ text: z.string().max(TEXT_MAX * 4), uploadId: uploadId.nullable().default(null) }).parse(req.body);
      res.json({ draft: d.drafts.save(me(req).id, body) });
    }),
    route('delete', '/api/drafts', 'user', (req, res) => {
      d.drafts.clear(me(req).id);
      res.json({ ok: true });
    }),

    // ---------------- images ----------------
    /** Body: the raw file (application/octet-stream). Header X-File-Name: original name (URI-encoded). */
    route('post', '/api/uploads', 'user', async (req, res) => {
      if (!Buffer.isBuffer(req.body)) throw badRequest('Send the image file as the request body.');
      let name = 'image';
      try {
        name = decodeURIComponent(req.get('x-file-name') ?? 'image');
      } catch {
        /* keep default */
      }
      const row = await d.images.store(ctxOf(req), me(req).id, req.body, name);
      res.status(201).json({ image: imageInfo(row) });
    }),
    /** Only the uploader (or an admin) can view an image. Never publicly cached. */
    route('get', '/api/uploads/:id', 'user', (req, res) => {
      const id = uploadId.parse(req.params.id);
      const u = d.images.get(id);
      if (!u || (!isAdmin(req) && u.userId !== me(req).id)) {
        if (u) throw forbidden('You can only view your own images.', 'not_owner');
        throw notFound('Image not found.');
      }
      const file = d.images.fileOf(id);
      if (u.deletedAt || !fs.existsSync(file)) {
        res.status(410).json({ error: 'This image has expired.', code: 'image_expired' });
        return;
      }
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', 'inline');
      fs.createReadStream(file).pipe(res);
    }),

    // ---------------- sending ----------------
    route('post', '/api/jobs', 'user', (req, res) => {
      const ctx = ctxOf(req);
      const u = me(req);
      const blocked = (reason: string, outcome: 'failure' | 'denied', details: Record<string, unknown> = {}) =>
        d.audit.record(ctx, { action: 'send.blocked', outcome, reason, connectionId: d.connections.active()?.id ?? null, details });

      const parsed = sendBody.safeParse(req.body);
      if (!parsed.success) {
        blocked('invalid_request', 'failure', { problem: parsed.error.issues[0]?.message });
        throw parsed.error;
      }
      const body = parsed.data;
      const a = d.composer.analyze({ text: body.text, uploadId: body.uploadId }, userOf(req));
      const base = {
        messageText: a.text,
        messageSha256: a.sha256,
        links: a.links.map((l) => ({ original: l.original, cleaned: l.cleaned, host: l.host })),
        image: imageInfo(a.image),
        sendMode: a.mode,
        groups: body.groupIds.length,
        presetIds: body.presetIds,
      };

      if (a.imageError) {
        blocked('image_missing', 'failure', base);
        throw badRequest(a.imageError, 'image_missing');
      }
      if (a.empty) {
        blocked('empty_message', 'failure', base);
        throw badRequest('Write a message first. Links are optional, but the message needs some text.', 'empty_message');
      }
      if (a.tooLong) {
        blocked('too_long', 'failure', { ...base, chars: a.chars, limit: a.limit });
        throw badRequest(
          a.mode === 'single'
            ? `With an image the text is sent as its caption, and WhatsApp allows at most ${a.limit.toLocaleString()} characters there (yours has ${a.chars.toLocaleString()}). Shorten the text or remove the image.`
            : `WhatsApp allows at most ${a.limit.toLocaleString()} characters in one message (yours has ${a.chars.toLocaleString()}).`,
          'too_long',
        );
      }

      const warnings: Record<string, unknown> = {};
      if (a.disallowed.length) {
        if (!isAdmin(req)) {
          blocked('link_not_allowed', 'denied', { ...base, hosts: a.disallowed });
          throw forbidden(`These links aren’t allowed: ${a.disallowed.join(', ')}. Remove them or ask an admin to allow the site.`, 'link_not_allowed');
        }
        if (!body.confirmLinks) {
          blocked('link_not_allowed', 'failure', { ...base, hosts: a.disallowed, needsConfirmation: true });
          throw conflict(`Some links are outside the allowed sites: ${a.disallowed.join(', ')}.`, 'links_need_confirmation', { hosts: a.disallowed });
        }
        warnings.disallowedLinks = { hosts: a.disallowed, resolution: 'confirmed by admin' };
        d.audit.record(ctx, { action: 'send.links_confirmed', reason: 'admin confirmed links outside the allowed domains', details: { ...base, hosts: a.disallowed } });
      }

      // Permission: users may only use their presets and groups inside them.
      const groupIds = [...new Set(body.groupIds)];
      const presetIds = [...new Set(body.presetIds)];
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

      const known = new Map(d.connections.activeGroups().map((g) => [g.id, g]));
      const unknown = groupIds.filter((g) => !known.has(g) || known.get(g)!.readOnly);
      if (unknown.length) {
        blocked('unknown_group', 'failure', { ...base, unavailableGroups: unknown.length });
        throw badRequest(
          `${unknown.length} chosen group(s) can't be used with the current WhatsApp number. Untick them${isAdmin(req) ? ' or refresh groups' : ''} and try again.`,
          'unknown_group',
        );
      }

      if (a.duplicate) {
        if (!body.confirmDuplicate) {
          blocked('duplicate', 'failure', { ...base, duplicate: a.duplicate });
          throw conflict('This looks like a post that was sent before.', 'duplicate', { duplicate: a.duplicate });
        }
        warnings.duplicate = { ...a.duplicate, resolution: 'resend confirmed' };
        d.audit.record(ctx, {
          action: 'send.duplicate_confirmed',
          targetType: 'job',
          targetId: a.duplicate.jobId,
          details: { ...base, previousJobId: a.duplicate.jobId, previousAt: new Date(a.duplicate.at).toISOString(), reasons: a.duplicate.reasons },
        });
      }

      const jobId = d.queue.enqueue({
        userId: u.id,
        messageText: a.text,
        messageSha256: a.sha256,
        textKey: a.textKey,
        imageId: a.image?.id ?? null,
        imageSha256: a.image?.originalSha256 ?? null,
        sendMode: a.mode,
        links: base.links,
        mainLinks: a.mainLinks,
        warnings: Object.keys(warnings).length ? warnings : null,
        presetIds,
        groups: groupIds.map((id) => ({ id, name: known.get(id)!.name })),
      });
      const presetNames = presetIds.length ? d.catalog.listPresets(presetIds).map((p) => p.name) : [];
      d.audit.record(ctx, {
        action: 'send.requested',
        targetType: 'job',
        targetId: jobId,
        connectionId: d.connections.active()?.id ?? null,
        details: { ...base, presetNames, mainLinks: a.mainLinks, connection: sending.connection?.label, warnings: Object.keys(warnings).length ? warnings : null },
      });
      d.drafts.clear(u.id);
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
        d.audit.record(ctx, { action: 'send.blocked', outcome: 'denied', reason: 'no_permission', details: { retryOf: job.id, messageSha256: job.messageSha256 } });
        throw forbidden('Some of these groups are no longer in your group lists. Ask your admin.', 'no_permission');
      }
      const sending = d.connections.sendingStatus();
      if (!sending.accepting) {
        d.audit.record(ctx, { action: 'send.blocked', outcome: 'failure', reason: 'connection_down', details: { retryOf: job.id } });
        throw new AppError(503, pausedMessage(req), 'sending_paused');
      }
      if (job.imageId && !fs.existsSync(d.images.fileOf(job.imageId))) {
        throw badRequest('The image of this send has expired, so it can’t be retried. Start a new send instead.', 'image_expired');
      }
      // Old (pre-composer) jobs only have a URL: retry sends that URL as the text.
      const text = job.messageText ?? normalizeMessage(job.url);
      const { links } = job.messageText ? { links: job.links } : cleanMessage(text);
      const messaging = d.settings.messaging();
      const jobId = d.queue.enqueue({
        userId: me(req).id,
        messageText: text,
        messageSha256: job.messageSha256 ?? sha256(text),
        textKey: textKey(text),
        imageId: job.imageId,
        imageSha256: job.imageSha256,
        sendMode: job.sendMode ?? 'text',
        links,
        mainLinks: mainLinks(
          links,
          d.catalog.listSnippets().map((s) => s.body),
          messaging.repeatingLinks,
        ),
        warnings: { retryOf: job.id },
        presetIds: job.presetIds,
        parentJobId: job.id,
        groups: failed,
      });
      d.audit.record(ctx, {
        action: 'send.requested',
        targetType: 'job',
        targetId: jobId,
        connectionId: d.connections.active()?.id ?? null,
        details: {
          messageText: text,
          messageSha256: job.messageSha256 ?? sha256(text),
          links,
          image: imageInfo(job.imageId ? (d.images.get(job.imageId) ?? null) : null),
          sendMode: job.sendMode ?? 'text',
          groups: failed.length,
          retryOf: job.id,
          presetIds: job.presetIds,
        },
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
