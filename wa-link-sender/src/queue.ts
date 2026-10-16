import type { AuditContext, AuditLog } from './audit.js';
import { SYSTEM } from './audit.js';
import type { Catalog, Template } from './catalog.js';
import type { Config } from './config.js';
import type { ConnectionManager } from './connections.js';
import type { WaitReason } from './db/schema.js';
import type { Job, JobItem, JobStore } from './jobs.js';
import type { Logger } from './logger.js';
import type { Settings } from './settings.js';
import { inWindow, localTime } from './time.js';
import type { Platform } from './urls.js';
import { NotConnectedError } from './whatsapp.js';

export interface QueueStatus {
  activeJobId: number | null;
  waitReason: WaitReason;
  nextSendAt: number | null;
  queued: number;
}

export function renderTemplate(body: string, url: string): string {
  return body.includes('{url}') ? body.replaceAll('{url}', url) : `${body.trim()}\n${url}`.trim();
}

const WAIT_TEXT: Record<Exclude<WaitReason, null>, string> = {
  connection_down: 'connection down',
  outside_hours: 'outside sending hours',
  daily_cap: 'daily cap reached',
};

/**
 * The single send worker. Jobs live in the database, so anything not yet sent survives a
 * restart. Exactly one message is in flight at a time, through the active connection, and
 * every safety rule (pause, per-connection daily cap, sending hours) is checked here.
 */
export class SendQueue {
  private stopping = false;
  private wakeUp: (() => void) | null = null;
  private loopDone: Promise<void> | null = null;
  private nextSendAt = 0;
  private lastTemplateId: number | null = null;
  private status: QueueStatus = { activeJobId: null, waitReason: null, nextSendAt: null, queued: 0 };

  constructor(
    private cfg: Config,
    private jobs: JobStore,
    private connections: ConnectionManager,
    private catalog: Catalog,
    private settings: Settings,
    private audit: AuditLog,
    private log: Logger,
    /** Called whenever a job changes (for live updates). */
    private onJob: (job: Job) => void = () => {},
    private onStatus: (s: QueueStatus) => void = () => {},
  ) {}

  start() {
    for (const item of this.jobs.recoverInterrupted()) {
      this.audit.record(SYSTEM, {
        action: 'send.result',
        outcome: 'failure',
        reason: 'interrupted by restart',
        targetType: 'send_result',
        targetId: item.id,
        connectionId: item.connectionId,
        details: { group: item.groupName },
      });
    }
    // Be polite after a restart too: wait at least the minimum pause before the first send.
    this.nextSendAt = Date.now() + this.settings.get().minDelaySeconds * 1000;
    this.loopDone = this.loop().catch((e) => this.log.fatal({ err: String(e) }, 'send loop crashed'));
  }

  /** Re-check right away (new job, cancel, settings change, connection back online). */
  kick() {
    this.wakeUp?.();
  }

  getStatus(): QueueStatus {
    return { ...this.status };
  }

  today() {
    return localTime(new Date(), this.cfg.TZ).day;
  }

  /** Today's usage of the active connection against the cap. */
  usage() {
    const a = this.connections.active();
    return { day: this.today(), used: a ? this.connections.usageToday(a.id) : 0, cap: this.settings.get().dailyCap, connectionId: a?.id ?? null };
  }

  private ownerCtx(jobId: number): AuditContext {
    const o = this.jobs.ownerOf(jobId);
    return o ? { actor: { userId: o.id, username: o.username, role: o.role } } : SYSTEM;
  }

  enqueue(input: {
    userId: number;
    url: string;
    platform: Platform;
    templateId: number | null;
    presetIds: number[];
    parentJobId?: number | null;
    groups: { id: string; name: string }[];
  }): number {
    const id = this.jobs.create({
      ...input,
      parentJobId: input.parentJobId ?? null,
      requestedConnectionId: this.connections.active()?.id ?? null,
    });
    this.emitJob(id);
    this.kick();
    return id;
  }

  cancel(ctx: AuditContext, jobId: number): boolean {
    const job = this.jobs.get(jobId);
    if (!job || job.status === 'done' || job.status === 'cancelled') return false;
    const skipped = this.jobs.cancelPending(jobId);
    // A message being sent right now finishes on its own; the loop then closes the job.
    if (!job.items?.some((i) => i.status === 'sending')) this.jobs.setStatus(jobId, 'cancelled', null, ctx.actor.userId ?? undefined);
    this.audit.record(ctx, {
      action: 'send.job_cancelled',
      targetType: 'job',
      targetId: jobId,
      details: { url: job.url, sent: job.sent, skipped, owner: job.username },
    });
    this.emitJob(jobId);
    this.kick();
    return true;
  }

  private blockReason(): WaitReason {
    const s = this.settings.get();
    if (!this.connections.isReady()) return 'connection_down';
    const now = localTime(new Date(), this.cfg.TZ);
    if (!inWindow(now.minutes, s.windowStart, s.windowEnd)) return 'outside_hours';
    const a = this.connections.active();
    if (a && this.connections.usageToday(a.id) >= s.dailyCap) return 'daily_cap';
    return null;
  }

  private sleep(ms: number) {
    return new Promise<void>((resolve) => {
      const t = setTimeout(done, ms);
      function done() {
        clearTimeout(t);
        resolve();
      }
      this.wakeUp = () => {
        this.wakeUp = null;
        done();
      };
    });
  }

  private setStatus(next: QueueStatus) {
    const s = this.status;
    if (s.activeJobId !== next.activeJobId || s.waitReason !== next.waitReason || s.nextSendAt !== next.nextSendAt || s.queued !== next.queued) {
      this.status = next;
      this.onStatus(next);
    }
  }

  private async loop() {
    while (!this.stopping) {
      const active = this.jobs.active();
      const job = active[0];
      if (!job) {
        this.setStatus({ activeJobId: null, waitReason: null, nextSendAt: null, queued: 0 });
        await this.sleep(60_000);
        continue;
      }

      const item = this.jobs.nextPending(job.id);
      if (!item) {
        const cancelled = this.jobs.hasCancelledItems(job.id);
        this.jobs.setStatus(job.id, cancelled ? 'cancelled' : 'done');
        const fin = this.jobs.get(job.id)!;
        if (!cancelled) {
          this.audit.record(this.ownerCtx(job.id), {
            action: 'send.job_completed',
            outcome: fin.failed ? 'failure' : 'success',
            reason: fin.failed ? `${fin.failed} of ${fin.total} groups failed` : null,
            targetType: 'job',
            targetId: job.id,
            details: { url: fin.url, total: fin.total, sent: fin.sent, failed: fin.failed },
          });
        }
        this.emitJob(job.id);
        continue;
      }

      const block = this.blockReason();
      if (block) {
        if (job.status !== 'waiting' || job.waitReason !== block) {
          this.jobs.setStatus(job.id, 'waiting', block);
          this.audit.record(this.ownerCtx(job.id), {
            action: 'send.blocked',
            outcome: 'failure',
            reason: block,
            targetType: 'job',
            targetId: job.id,
            connectionId: this.connections.active()?.id ?? null,
            details: { url: job.url, deferred: true, explanation: `Paused: ${WAIT_TEXT[block]}. It continues automatically.` },
          });
          this.emitJob(job.id);
        }
        this.setStatus({ activeJobId: job.id, waitReason: block, nextSendAt: null, queued: active.length - 1 });
        await this.sleep(30_000);
        continue;
      }

      if (job.status !== 'running') {
        const first = !job.startedAt;
        this.jobs.setStatus(job.id, 'running');
        if (first) {
          this.audit.record(this.ownerCtx(job.id), {
            action: 'send.job_started',
            targetType: 'job',
            targetId: job.id,
            connectionId: this.connections.active()?.id ?? null,
            details: { url: job.url, groups: job.total },
          });
        }
        this.emitJob(job.id);
      }

      const wait = this.nextSendAt - Date.now();
      this.setStatus({ activeJobId: job.id, waitReason: null, nextSendAt: wait > 0 ? this.nextSendAt : Date.now(), queued: active.length - 1 });
      if (wait > 0) {
        await this.sleep(wait);
        continue; // re-check everything: the job may have been cancelled meanwhile
      }

      await this.sendItem(job, item);
    }
  }

  private pickTemplate(templateId: number | null): Template | null {
    const all = this.catalog.listTemplates();
    if (templateId !== null) {
      const chosen = all.find((t) => t.id === templateId);
      if (chosen) return chosen;
    }
    const pool = all.filter((t) => t.active);
    if (pool.length === 0) return null;
    const fresh = pool.length > 1 ? pool.filter((t) => t.id !== this.lastTemplateId) : pool;
    return fresh[Math.floor(Math.random() * fresh.length)] ?? null;
  }

  private recordResult(job: Job, item: JobItem, connectionId: number | null, outcome: 'success' | 'failure', error: string | null) {
    return this.audit.record(this.ownerCtx(job.id), {
      action: 'send.result',
      outcome,
      reason: error,
      targetType: 'send_result',
      targetId: item.id,
      connectionId,
      details: { jobId: job.id, group: item.groupName, groupId: item.groupId, url: job.url, result: outcome === 'success' ? 'sent' : 'failed' },
    });
  }

  private async sendItem(job: Job, item: JobItem) {
    const conn = this.connections.active();
    const group = this.connections.activeGroups().find((g) => g.id === item.groupId);
    if (!group || group.readOnly) {
      const error = !group
        ? 'The active WhatsApp number is not in this group. Add the number to the group, then refresh groups.'
        : 'Only admins can post in this group, or the number left it.';
      const auditId = this.recordResult(job, item, conn?.id ?? null, 'failure', error);
      this.jobs.finish(item.id, 'failed', error, auditId);
      this.emitJob(job.id);
      return;
    }

    const template = this.pickTemplate(job.templateId);
    this.lastTemplateId = template?.id ?? null;
    const text = template ? renderTemplate(template.body, job.url) : job.url;
    this.jobs.markSending(item.id, text, this.today(), conn!.id);
    this.emitJob(job.id);
    const log = this.log.child({ jobId: job.id, itemId: item.id, group: item.groupName });

    try {
      const usedId = await this.connections.sendText(item.groupId, text);
      const auditId = this.recordResult(job, item, usedId, 'success', null);
      this.jobs.finish(item.id, 'sent', null, auditId);
      log.info('message sent');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (e instanceof NotConnectedError || !this.connections.isReady()) {
        // Not this group's fault: put it back and wait for the connection.
        this.jobs.finish(item.id, 'pending');
        log.warn({ err: msg }, 'send interrupted by connection loss; will retry');
      } else {
        const error = friendlyError(msg);
        const auditId = this.recordResult(job, item, conn!.id, 'failure', error);
        this.jobs.finish(item.id, 'failed', error, auditId);
        log.warn({ err: msg }, 'message failed');
      }
    }

    const s = this.settings.get();
    this.nextSendAt = Date.now() + (s.minDelaySeconds + Math.random() * (s.maxDelaySeconds - s.minDelaySeconds)) * 1000;
    this.emitJob(job.id);
  }

  private emitJob(id: number) {
    const job = this.jobs.get(id);
    if (job) this.onJob(job);
  }

  async stop() {
    this.stopping = true;
    this.kick();
    if (this.loopDone) await Promise.race([this.loopDone, new Promise((r) => setTimeout(r, 15_000))]);
  }
}

function friendlyError(msg: string): string {
  if (/timed out/i.test(msg)) return 'WhatsApp took too long to respond. Try again later.';
  if (/not.*found|invalid wid|no lid/i.test(msg)) return 'This group could not be found. Ask an admin to refresh groups.';
  return `WhatsApp did not accept the message (${msg.slice(0, 160)}).`;
}
