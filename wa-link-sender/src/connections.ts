import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { SYSTEM, type AuditContext, type AuditLog } from './audit.js';
import type { Config } from './config.js';
import type { Db } from './db/index.js';
import { connections, groups, sendResults, users, type ConnectionStatus } from './db/schema.js';
import { badRequest, conflict, notFound } from './errors.js';
import type { Logger } from './logger.js';
import { localTime } from './time.js';
import { classifyGroups, type GroupInfo, type RawChat } from './groups.js';
import type { SendMode } from './jobs.js';
import { NotConnectedError, sessionDirFor, type WaRuntimeState } from './whatsapp.js';

/** What the manager needs from a running WhatsApp client (WaClient in production, a fake in tests). */
export interface WaRuntime extends EventEmitter {
  readonly clientId: string;
  state: WaRuntimeState;
  qr: string | null;
  lastError: string | null;
  nextRetryAt: number | null;
  start(): void;
  stop(): Promise<void>;
  logout(): Promise<void>;
  isReady(): boolean;
  listGroups(): Promise<GroupInfo[]>;
  /** Raw per-chat metadata for diagnostics (fresh from WhatsApp). */
  inspectChats(fresh: boolean): Promise<RawChat[]>;
  sendPost(groupId: string, post: { text: string; imagePath: string | null; mode: SendMode }): Promise<void>;
}
export type RuntimeFactory = (clientId: string) => WaRuntime;

export type ConnectionRecord = typeof connections.$inferSelect;

export interface ConnectionView extends ConnectionRecord {
  addedByUsername: string | null;
  qr: string | null;
  running: boolean;
  runtimeState: WaRuntimeState | null;
  nextRetryAt: number | null;
  sentToday: number;
  sentTotal: number;
}

export type PauseReason = 'no_active' | 'connecting' | 'disconnected' | 'logged_out' | 'possibly_banned' | 'linking' | null;

export interface SendingStatus {
  /** True when the active number is connected right now. */
  available: boolean;
  /** True when new sends are accepted (connected, or reconnecting by itself). */
  accepting: boolean;
  reason: PauseReason;
  connection: { id: number; label: string; phone: string | null; status: ConnectionStatus } | null;
}

const LINK_TIMEOUT_MS = 5 * 60_000;

type Mode = 'run' | 'link';

export class ConnectionManager extends EventEmitter {
  private runtimes = new Map<number, { rt: WaRuntime; mode: Mode }>();
  private linkingId: number | null = null;
  private linkTimer: NodeJS.Timeout | null = null;
  /** Who started a link, so the "linked" / "activated" audit rows are attributed to them. */
  private linkCtx = new Map<number, AuditContext>();
  private qrLogged = new Set<number>();
  private wasDisconnected = new Set<number>();

  constructor(
    private db: Db,
    private audit: AuditLog,
    private cfg: Config,
    private log: Logger,
    private makeRuntime: RuntimeFactory,
  ) {
    super();
  }

  // ---------------- queries ----------------

  private get(id: number): ConnectionRecord {
    const r = this.db.select().from(connections).where(eq(connections.id, id)).get();
    if (!r) throw notFound('That WhatsApp connection was not found.');
    return r;
  }

  active(): ConnectionRecord | undefined {
    return this.db.select().from(connections).where(eq(connections.isActive, true)).get();
  }

  activeRuntime(): WaRuntime | null {
    const a = this.active();
    const entry = a ? this.runtimes.get(a.id) : undefined;
    return entry && entry.mode === 'run' ? entry.rt : null;
  }

  isReady(): boolean {
    return this.activeRuntime()?.isReady() ?? false;
  }

  sendingStatus(): SendingStatus {
    const a = this.active();
    if (!a) return { available: false, accepting: false, reason: 'no_active', connection: null };
    const ready = this.isReady();
    const conn = { id: a.id, label: a.label, phone: a.phone, status: a.status };
    if (ready) return { available: true, accepting: true, reason: null, connection: conn };
    const reason: PauseReason =
      a.status === 'logged_out' || a.status === 'possibly_banned' || a.status === 'linking'
        ? a.status
        : a.status === 'disconnected'
          ? 'disconnected'
          : 'connecting';
    const accepting = reason === 'connecting' || reason === 'disconnected';
    return { available: false, accepting, reason, connection: conn };
  }

  private stats(): Map<number, { today: number; total: number }> {
    const today = localTime(new Date(), this.cfg.TZ).day;
    const rows = this.db
      .select({
        id: sendResults.connectionId,
        total: sql<number>`count(*)`,
        today: sql<number>`sum(case when ${sendResults.day} = ${today} then 1 else 0 end)`,
      })
      .from(sendResults)
      .where(and(eq(sendResults.status, 'sent'), isNotNull(sendResults.connectionId)))
      .groupBy(sendResults.connectionId)
      .all();
    return new Map(rows.map((r) => [r.id!, { today: Number(r.today) || 0, total: Number(r.total) || 0 }]));
  }

  list(): ConnectionView[] {
    const stats = this.stats();
    const rows = this.db
      .select({ c: connections, addedByUsername: users.username })
      .from(connections)
      .leftJoin(users, eq(users.id, connections.addedBy))
      .orderBy(connections.id)
      .all();
    return rows.map(({ c, addedByUsername }) => {
      const entry = this.runtimes.get(c.id);
      return {
        ...c,
        addedByUsername,
        qr: entry?.rt.state === 'qr' ? entry.rt.qr : null,
        running: !!entry,
        runtimeState: entry?.rt.state ?? null,
        nextRetryAt: entry?.rt.nextRetryAt ?? null,
        sentToday: stats.get(c.id)?.today ?? 0,
        sentTotal: stats.get(c.id)?.total ?? 0,
      };
    });
  }

  /** WhatsApp messages attempted today by a connection (sent, failed and in-flight count; an image+text pair counts 2). */
  usageToday(connectionId: number): number {
    const today = localTime(new Date(), this.cfg.TZ).day;
    const r = this.db
      .select({ n: sql<number>`coalesce(sum(${sendResults.messagesCount}), 0)` })
      .from(sendResults)
      .where(
        and(
          eq(sendResults.connectionId, connectionId),
          eq(sendResults.day, today),
          sql`${sendResults.status} in ('sent','failed','sending')`,
        ),
      )
      .get();
    return Number(r?.n) || 0;
  }

  private update(id: number, patch: Partial<ConnectionRecord>) {
    this.db.update(connections).set(patch).where(eq(connections.id, id)).run();
    this.changed();
  }

  private changed() {
    this.emit('changed');
    this.emit('sending', this.sendingStatus());
  }

  // ---------------- lifecycle ----------------

  /** On start-up: tidy statuses left from the last run and start the active number. */
  boot() {
    for (const c of this.db.select().from(connections).all()) {
      if (c.status === 'retired') continue;
      if (c.isActive) continue;
      if (c.status === 'linking') this.update(c.id, { status: 'link_expired' });
      else if (c.status === 'connected' || c.status === 'connecting' || c.status === 'disconnected') {
        this.update(c.id, { status: 'standby' });
      }
    }
    const a = this.active();
    if (!a) return;
    if (a.status === 'linking' || a.status === 'link_expired') {
      // Was being re-linked when the app stopped; the old session was already wiped.
      this.update(a.id, { status: 'link_expired' });
      return;
    }
    if (a.status === 'logged_out' || a.status === 'possibly_banned' || a.status === 'retired') return;
    this.startRuntime(a, 'run', SYSTEM);
  }

  private startRuntime(rec: ConnectionRecord, mode: Mode, ctx: AuditContext) {
    const existing = this.runtimes.get(rec.id);
    if (existing) return existing.rt;
    const rt = this.makeRuntime(rec.clientId);
    this.runtimes.set(rec.id, { rt, mode });
    const id = rec.id;
    const audit = (ev: Parameters<AuditLog['record']>[1]) => this.audit.record(ctx, { targetType: 'connection', targetId: id, connectionId: id, ...ev });

    rt.on('state', (state: WaRuntimeState) => {
      const entry = this.runtimes.get(id);
      if (!entry) return;
      if (entry.mode === 'link') {
        if (state === 'qr') this.update(id, { status: 'linking' });
        else this.changed();
        return;
      }
      if (state === 'starting' || state === 'authenticating') this.update(id, { status: 'connecting' });
      else if (state === 'reconnecting') this.update(id, { status: 'disconnected', lastError: rt.lastError, lastErrorAt: Date.now() });
      else this.changed();
    });

    rt.on('qr', () => {
      const entry = this.runtimes.get(id);
      if (!entry) return;
      if (entry.mode === 'run') {
        // A running number asked for a QR: its saved login is no longer valid.
        audit({ action: 'connection.logged_out', outcome: 'failure', reason: 'Saved login is no longer valid (WhatsApp asked for a new QR scan)' });
        void this.stopRuntime(id).then(() => {
          this.wipe(rec.clientId);
          this.update(id, { status: 'logged_out', lastError: 'Saved login expired. Re-link this number.', lastErrorAt: Date.now() });
        });
        return;
      }
      if (!this.qrLogged.has(id)) {
        this.qrLogged.add(id);
        audit({ action: 'connection.qr_generated' });
      }
      this.changed();
    });

    rt.on('ready', (info: { phone: string | null; pushName: string | null }) => {
      const entry = this.runtimes.get(id);
      if (!entry) return;
      if (entry.mode === 'link') {
        this.finishLink(id, info);
        return;
      }
      this.update(id, {
        status: 'connected',
        lastError: null,
        ...(info.phone ? { phone: info.phone } : {}),
        ...(info.pushName ? { pushName: info.pushName } : {}),
      });
      if (this.wasDisconnected.delete(id)) audit({ action: 'connection.reconnected', details: { phone: info.phone } });
      this.emit('active_ready', id);
    });

    rt.on('disconnected', (reason: string) => {
      this.wasDisconnected.add(id);
      audit({ action: 'connection.disconnected', outcome: 'failure', reason });
    });
    rt.on('reconnect', (r: { attempt: number; delayMs: number; reason: string }) => {
      audit({ action: 'connection.reconnect_attempt', outcome: 'failure', reason: r.reason, details: { attempt: r.attempt, retryInSeconds: Math.round(r.delayMs / 1000) } });
    });
    rt.on('start_failed', (err: string) => {
      this.update(id, { lastError: err, lastErrorAt: Date.now() });
      audit({ action: 'connection.reconnect_failed', outcome: 'failure', reason: err });
    });
    rt.on('logged_out', ({ reason, suspectedBan }: { reason: string; suspectedBan: boolean }) => {
      const status: ConnectionStatus = suspectedBan ? 'possibly_banned' : 'logged_out';
      this.runtimes.delete(id);
      if (this.linkingId === id) this.clearLink();
      this.wipe(rec.clientId);
      this.update(id, {
        status,
        lastError: suspectedBan
          ? `${reason}. The number may be banned. Check the phone, then link a different number if needed.`
          : `${reason}. If nobody unlinked it on the phone, WhatsApp may have banned the number.`,
        lastErrorAt: Date.now(),
      });
      audit({
        action: suspectedBan ? 'connection.suspected_ban' : 'connection.logged_out',
        outcome: 'failure',
        reason,
        details: { phone: this.get(id).phone, wasActive: this.get(id).isActive },
      });
    });

    rt.start();
    this.changed();
    return rt;
  }

  private async stopRuntime(id: number) {
    const entry = this.runtimes.get(id);
    if (!entry) return;
    this.runtimes.delete(id);
    entry.rt.removeAllListeners();
    await entry.rt.stop();
    this.changed();
  }

  private wipe(clientId: string) {
    try {
      fs.rmSync(sessionDirFor(this.cfg.WWEBJS_AUTH_DIR, clientId), { recursive: true, force: true, maxRetries: 3 });
    } catch (e) {
      this.log.error({ clientId, err: e instanceof Error ? e.message : String(e) }, 'could not remove session folder');
    }
  }

  private clearLink() {
    if (this.linkTimer) clearTimeout(this.linkTimer);
    this.linkTimer = null;
    this.linkingId = null;
  }

  // ---------------- admin actions ----------------

  /** Adds a number: creates the record and shows its QR code. */
  add(ctx: AuditContext, label: string): ConnectionRecord {
    if (this.linkingId !== null) {
      throw conflict('Another number is being linked right now. Finish or cancel that first.', 'linking_in_progress');
    }
    const name = label.trim() || 'WhatsApp number';
    const rec = this.db
      .insert(connections)
      .values({
        label: name.slice(0, 60),
        clientId: `wa-${crypto.randomBytes(6).toString('hex')}`,
        status: 'linking',
        isActive: false,
        addedAt: Date.now(),
        addedBy: ctx.actor.userId,
      })
      .returning()
      .get();
    this.audit.record(ctx, { action: 'connection.added', targetType: 'connection', targetId: rec.id, connectionId: rec.id, details: { label: rec.label } });
    this.beginLink(ctx, rec);
    return rec;
  }

  private beginLink(ctx: AuditContext, rec: ConnectionRecord) {
    this.linkingId = rec.id;
    this.linkCtx.set(rec.id, ctx);
    this.qrLogged.delete(rec.id);
    this.startRuntime(rec, 'link', ctx);
    this.linkTimer = setTimeout(() => void this.expireLink(rec.id), LINK_TIMEOUT_MS);
    this.linkTimer.unref();
  }

  private async expireLink(id: number) {
    if (this.linkingId !== id) return;
    this.clearLink();
    await this.stopRuntime(id);
    this.update(id, { status: 'link_expired' });
    this.audit.record(this.linkCtx.get(id) ?? SYSTEM, {
      action: 'connection.link_expired',
      outcome: 'failure',
      reason: 'The QR code was not scanned within 5 minutes',
      targetType: 'connection',
      targetId: id,
      connectionId: id,
    });
  }

  private finishLink(id: number, info: { phone: string | null; pushName: string | null }) {
    const ctx = this.linkCtx.get(id) ?? SYSTEM;
    this.clearLink();
    const rec = this.get(id);
    const duplicate = info.phone
      ? this.db
          .select({ id: connections.id, label: connections.label })
          .from(connections)
          .where(and(eq(connections.phone, info.phone), sql`${connections.id} != ${id}`, sql`${connections.status} != 'retired'`))
          .all()
      : [];
    this.update(id, { phone: info.phone, pushName: info.pushName, linkedAt: Date.now(), lastError: null });
    this.audit.record(ctx, {
      action: 'connection.linked',
      targetType: 'connection',
      targetId: id,
      connectionId: id,
      details: { phone: info.phone, pushName: info.pushName, alsoUsedBy: duplicate },
    });

    const active = this.active();
    if (!active || active.id === id) {
      // First number (or re-linking the active one): keep it running as the active connection.
      const entry = this.runtimes.get(id);
      if (entry) entry.mode = 'run';
      if (!active) {
        this.db.update(connections).set({ isActive: true }).where(eq(connections.id, id)).run();
        this.audit.record(ctx, {
          action: 'connection.activated',
          targetType: 'connection',
          targetId: id,
          connectionId: id,
          reason: 'first connection',
          details: { from: null, to: id },
        });
      }
      this.update(id, { status: 'connected' });
      this.emit('active_ready', id);
      return;
    }
    // Another number is active: keep this one's login on disk and stop its browser.
    void this.stopRuntime(id).then(() => this.update(id, { status: 'standby' }));
  }

  /** Shows a fresh QR for an existing record (link expired, logged out, banned, or replace its phone). */
  async relink(ctx: AuditContext, id: number) {
    const rec = this.get(id);
    if (rec.status === 'retired') throw badRequest('This number was removed. Add it again as a new connection.');
    if (this.linkingId !== null && this.linkingId !== id) {
      throw conflict('Another number is being linked right now. Finish or cancel that first.', 'linking_in_progress');
    }
    if (this.linkingId === id) this.clearLink();
    await this.stopRuntime(id);
    this.wipe(rec.clientId);
    this.update(id, { status: 'linking', lastError: null });
    this.audit.record(ctx, { action: 'connection.relink_started', targetType: 'connection', targetId: id, connectionId: id, details: { previousStatus: rec.status } });
    this.beginLink(ctx, this.get(id));
  }

  async cancelLink(ctx: AuditContext, id: number) {
    if (this.linkingId !== id) throw badRequest('This number is not being linked right now.');
    this.clearLink();
    await this.stopRuntime(id);
    this.update(id, { status: 'link_expired' });
    this.audit.record(ctx, { action: 'connection.link_cancelled', targetType: 'connection', targetId: id, connectionId: id });
  }

  /** Makes a linked number the one used for sending. Never happens automatically. */
  async activate(ctx: AuditContext, id: number) {
    const rec = this.get(id);
    const prev = this.active();
    if (prev?.id === id) {
      if (!this.runtimes.has(id) && rec.status === 'standby') this.startRuntime(rec, 'run', ctx);
      return;
    }
    if (!rec.linkedAt || !['standby', 'connected', 'disconnected', 'connecting'].includes(rec.status)) {
      this.audit.record(ctx, { action: 'connection.activated', outcome: 'failure', reason: `status ${rec.status}`, targetType: 'connection', targetId: id, connectionId: id });
      throw badRequest('Only a linked number in standby can be made active. Link it first (scan its QR code).');
    }
    if (prev) {
      await this.stopRuntime(prev.id);
      if (['connected', 'connecting', 'disconnected'].includes(prev.status)) {
        this.db.update(connections).set({ status: 'standby' }).where(eq(connections.id, prev.id)).run();
      }
    }
    this.db.transaction((tx) => {
      tx.update(connections).set({ isActive: false }).where(eq(connections.isActive, true)).run();
      tx.update(connections).set({ isActive: true, status: 'connecting' }).where(eq(connections.id, id)).run();
    });
    this.audit.record(ctx, {
      action: 'connection.activated',
      targetType: 'connection',
      targetId: id,
      connectionId: id,
      details: { from: prev ? { id: prev.id, label: prev.label, phone: prev.phone } : null, to: { id, label: rec.label, phone: rec.phone } },
    });
    this.startRuntime(this.get(id), 'run', ctx);
  }

  /** Unlink & remove: logs out on WhatsApp (if running), deletes the session, keeps the record as retired. */
  async remove(ctx: AuditContext, id: number) {
    const rec = this.get(id);
    if (rec.status === 'retired') return;
    if (this.linkingId === id) this.clearLink();
    const entry = this.runtimes.get(id);
    let loggedOutOnPhone = false;
    if (entry) {
      this.runtimes.delete(id);
      entry.rt.removeAllListeners();
      loggedOutOnPhone = entry.rt.isReady();
      await entry.rt.logout();
    }
    this.wipe(rec.clientId);
    this.update(id, { status: 'retired', isActive: false, retiredAt: Date.now(), retiredBy: ctx.actor.userId });
    this.audit.record(ctx, {
      action: 'connection.removed',
      targetType: 'connection',
      targetId: id,
      connectionId: id,
      details: { label: rec.label, phone: rec.phone, wasActive: rec.isActive, loggedOutOnPhone },
    });
  }

  // ---------------- groups & sending ----------------

  groupsFor(connectionId: number): GroupInfo[] {
    return this.db
      .select({
        id: groups.groupId,
        name: groups.name,
        readOnly: groups.readOnly,
        reason: groups.reason,
        kind: groups.kind,
        communityId: groups.communityId,
        communityName: groups.communityName,
        participants: groups.participants,
      })
      .from(groups)
      .where(eq(groups.connectionId, connectionId))
      .orderBy(sql`lower(coalesce(${groups.communityName}, '~'))`, sql`lower(${groups.name})`)
      .all();
  }

  activeGroups(): GroupInfo[] {
    const a = this.active();
    return a ? this.groupsFor(a.id) : [];
  }

  async refreshGroups(ctx: AuditContext): Promise<GroupInfo[]> {
    const a = this.active();
    const rt = this.activeRuntime();
    if (!a || !rt || !rt.isReady()) throw new NotConnectedError();
    let list: GroupInfo[];
    try {
      list = await rt.listGroups();
    } catch (e) {
      this.audit.record(ctx, { action: 'group.refreshed', outcome: 'failure', reason: e instanceof Error ? e.message : String(e), connectionId: a.id });
      throw e;
    }
    const before = new Set(this.groupsFor(a.id).map((g) => g.id));
    const after = new Set(list.map((g) => g.id));
    const now = Date.now();
    this.db.transaction((tx) => {
      tx.delete(groups).where(eq(groups.connectionId, a.id)).run();
      if (list.length) {
        tx.insert(groups)
          .values(
            list.map((g) => ({
              connectionId: a.id,
              groupId: g.id,
              name: g.name,
              readOnly: g.readOnly,
              reason: g.reason ?? null,
              kind: g.kind ?? 'group',
              communityId: g.communityId ?? null,
              communityName: g.communityName ?? null,
              participants: g.participants ?? null,
              updatedAt: now,
            })),
          )
          .run();
      }
    });
    this.audit.record(ctx, {
      action: 'group.refreshed',
      connectionId: a.id,
      details: {
        count: list.length,
        canPost: list.filter((g) => !g.readOnly).length,
        communities: new Set(list.map((g) => g.communityId).filter(Boolean)).size,
        added: [...after].filter((g) => !before.has(g)).length,
        removed: [...before].filter((g) => !after.has(g)).length,
      },
    });
    this.emit('groups', a.id);
    return list;
  }

  /**
   * Diagnostics: raw WhatsApp metadata for every chat, compared with what the app shows.
   * Each chat is also written to the application log (docker compose logs app).
   */
  async debugGroups(ctx: AuditContext) {
    const a = this.active();
    const rt = this.activeRuntime();
    if (!a || !rt || !rt.isReady()) throw new NotConnectedError();
    const chats = await rt.inspectChats(true);
    const classified = new Map(classifyGroups(chats).map((g) => [g.id, g]));
    const stored = new Map(this.groupsFor(a.id).map((g) => [g.id, g]));
    const rows = chats.map((c) => {
      const g = classified.get(c.id);
      return {
        ...c,
        shownAs: g?.name ?? null,
        kind: g?.kind ?? null,
        canPost: g ? !g.readOnly : false,
        reason: g?.reason ?? (c.isGroup ? null : 'Not a group'),
        inSavedList: stored.has(c.id),
      };
    });
    for (const r of rows) {
      if (!r.isGroup) continue;
      this.log.info({ groupDebug: r }, `group debug ${r.id}`);
    }
    // Unjoined Community subgroups aren't chats; include them so the comparison is complete.
    const extra = [...classified.values()].filter((g) => !chats.some((c) => c.id === g.id));
    const summary = {
      chats: chats.length,
      groupChats: rows.filter((r) => r.isGroup).length,
      communities: rows.filter((r) => r.isParentGroup).length,
      announcementGroups: rows.filter((r) => r.defaultSubgroup).length,
      canPost: rows.filter((r) => r.canPost).length,
      metadataMissing: rows.filter((r) => r.isGroup && !r.metaLoaded).length,
      fetchErrors: rows.filter((r) => r.metaError).length,
      unjoinedSubgroups: extra.length,
      savedListDiffers: rows.filter((r) => r.isGroup && !r.inSavedList).length,
    };
    this.audit.record(ctx, { action: 'group.debug_dumped', connectionId: a.id, details: summary });
    return { summary, chats: rows.filter((r) => r.isGroup), others: rows.filter((r) => !r.isGroup).length, unjoined: extra };
  }

  /** Sends one post through the active number; returns the connection id used. */
  async sendPost(groupId: string, post: { text: string; imagePath: string | null; mode: SendMode }): Promise<number> {
    const a = this.active();
    const rt = this.activeRuntime();
    if (!a || !rt || !rt.isReady()) throw new NotConnectedError();
    await rt.sendPost(groupId, post);
    return a.id;
  }

  async stopAll() {
    this.clearLink();
    await Promise.all([...this.runtimes.keys()].map((id) => this.stopRuntime(id)));
  }
}
