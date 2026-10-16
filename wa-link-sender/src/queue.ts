import fs from 'node:fs';
import type { AuditContext, AuditLog } from './audit.js';
import { SYSTEM } from './audit.js';
import type { Config } from './config.js';
import type { ConnectionManager } from './connections.js';
import type { WaitReason } from './db/schema.js';
import type { Images } from './images.js';
import type { Job, JobItem, JobStore, NewJob, SendMode } from './jobs.js';
import type { Logger } from './logger.js';
import type { Settings } from './settings.js';
import { inWindow, localTime } from './time.js';
import { NotConnectedError, SendError } from './whatsapp.js';

export interface QueueStatus {
  activeJobId: number | null;
  waitReason: WaitReason;
  nextSendAt: number | null;
  queued: number;
}

const WAIT_TEXT: Record<Exclude<WaitReason, null>, string> = {
  connection_down: 'connection down',
  outside_hours: 'outside sending hours',
  daily_cap: 'daily cap reached',
};

/** Pause before the single automatic retry (only when nothing was sent). */
export const RETRY_PAUSE_MS = 10_000;

/**
 * The single send worker. Jobs live in the database, so anything not yet sent survives a
 * restart. Exactly one post is in flight at a time, through the active connection, and
 * every safety rule (pause, per-connection daily cap, sending hours) is checked here.
 */
export class SendQueue {
  private stopping = false;
  private wakeUp: (() => void) | null = null;
  private loopDone: Promise<void> | null = null;
  private nextSendAt = 0;
  private status: QueueStatus = { activeJobId: null, waitReason: null, nextSendAt: null, queued: 0 };
  /** Overridable in tests. */
  retryPauseMs = RETRY_PAUSE_MS;

  constructor(
    private cfg: Config,
    private jobs: JobStore,
    private connections: ConnectionManager,
    private images: Images,
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

  /** Today's usage of the active connection against the cap (WhatsApp messages; image+text pair = 2). */
  usage() {
    const a = this.connections.active();
    return { day: this.today(), used: a ? this.connections.usageToday(a.id) : 0, cap: this.settings.get().dailyCap, connectionId: a?.id ?? null };
  }

  private ownerCtx(jobId: number): AuditContext {
    const o = this.jobs.ownerOf(jobId);
    return o ? { actor: { userId: o.id, username: o.username, role: o.role } } : SYSTEM;
  }

  enqueue(input: Omit<NewJob, 'requestedConnectionId' | 'parentJobId'> & { parentJobId?: number | null }): number {
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
    // A post being sent right now finishes on its own; the loop then closes the job.
    if (!job.items?.some((i) => i.status === 'sending')) this.jobs.setStatus(jobId, 'cancelled', null, ctx.actor.userId ?? undefined);
    this.audit.record(ctx, {
      action: 'send.job_cancelled',
      targetType: 'job',
      targetId: jobId,
      details: { messageSha256: job.messageSha256, url: job.url, sent: job.sent, skipped, owner: job.username },
    });
    this.emitJob(jobId);
    this.kick();
    return true;
  }

  /** WhatsApp messages one group of this job costs. */
  private weightOf(job: Job): number {
    return job.imageId && job.sendMode === 'two' ? 2 : 1;
  }

  private blockReason(job: Job): WaitReason {
    const s = this.settings.get();
    if (!this.connections.isReady()) return 'connection_down';
    const now = localTime(new Date(), this.cfg.TZ);
    if (!inWindow(now.minutes, s.windowStart, s.windowEnd)) return 'outside_hours';
    const a = this.connections.active();
    if (a && this.connections.usageToday(a.id) + this.weightOf(job) > s.dailyCap) return 'daily_cap';
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
            details: { messageSha256: fin.messageSha256, url: fin.url, total: fin.total, sent: fin.sent, failed: fin.failed },
          });
        }
        this.emitJob(job.id);
        continue;
      }

      const block = this.blockReason(job);
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
            details: { messageSha256: job.messageSha256, deferred: true, explanation: `Paused: ${WAIT_TEXT[block]}. It continues automatically.` },
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
            details: { messageSha256: job.messageSha256, groups: job.total, sendMode: job.sendMode },
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

  /** Everything the audit log must carry for a per-group result. */
  private resultDetails(job: Job, item: JobItem, extra: Record<string, unknown>) {
    const img = job.imageId ? this.images.get(job.imageId) : undefined;
    return {
      jobId: job.id,
      group: item.groupName,
      groupId: item.groupId,
      messageText: job.messageText ?? job.url,
      messageSha256: job.messageSha256,
      links: job.links,
      image: img
        ? { id: img.id, originalName: img.originalName, originalSize: img.originalSize, originalSha256: img.originalSha256, processedSha256: img.sha256 }
        : null,
      sendMode: job.sendMode ?? 'text',
      warnings: job.warnings,
      ...extra,
    };
  }

  private async sendItem(job: Job, item: JobItem) {
    const conn = this.connections.active();
    const fail = (error: string, extra: Record<string, unknown> = {}) => {
      const auditId = this.audit.record(this.ownerCtx(job.id), {
        action: 'send.result',
        outcome: 'failure',
        reason: error,
        targetType: 'send_result',
        targetId: item.id,
        connectionId: conn?.id ?? null,
        details: this.resultDetails(job, item, { result: 'failed', ...extra }),
      });
      this.jobs.finish(item.id, 'failed', error, auditId);
    };

    const group = this.connections.activeGroups().find((g) => g.id === item.groupId);
    if (!group || group.readOnly) {
      fail(
        !group
          ? 'The active WhatsApp number is not in this group. Add the number to the group, then refresh groups.'
          : `This number can’t post here: ${group.reason ?? 'only admins can send'}. Refresh groups if that changed.`,
      );
      this.emitJob(job.id);
      return;
    }

    // Old (pre-composer) jobs carry only a URL.
    const text = job.messageText ?? job.url;
    const mode: SendMode = job.imageId ? (job.sendMode === 'two' ? 'two' : 'single') : 'text';
    let imagePath: string | null = null;
    if (job.imageId) {
      imagePath = this.images.fileOf(job.imageId);
      if (!fs.existsSync(imagePath)) {
        fail('The attached image has expired and was deleted, so nothing was sent.');
        this.emitJob(job.id);
        return;
      }
    }

    const log = this.log.child({ jobId: job.id, itemId: item.id, group: item.groupName });
    let attempt = 0;
    for (;;) {
      attempt++;
      this.jobs.markSending(item.id, text, this.today(), conn!.id, this.weightOf(job));
      this.emitJob(job.id);
      try {
        const usedId = await this.connections.sendPost(item.groupId, { text, imagePath, mode });
        const auditId = this.audit.record(this.ownerCtx(job.id), {
          action: 'send.result',
          targetType: 'send_result',
          targetId: item.id,
          connectionId: usedId,
          details: this.resultDetails(job, item, { result: 'sent', attempts: attempt }),
        });
        this.jobs.finish(item.id, 'sent', null, auditId);
        log.info({ attempts: attempt, mode }, 'message sent');
        break;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (e instanceof NotConnectedError || !this.connections.isReady()) {
          // Not this group's fault: put it back and wait for the connection.
          this.jobs.finish(item.id, 'pending');
          log.warn({ err: msg }, 'send interrupted by connection loss; will retry');
          break;
        }
        const sent = e instanceof SendError ? e.sent : 'maybe';
        if (sent === 'no' && attempt < 2) {
          log.warn({ err: msg }, 'nothing was sent; retrying once after a pause');
          await new Promise((r) => setTimeout(r, this.retryPauseMs));
          if (this.stopping) {
            this.jobs.finish(item.id, 'pending');
            break;
          }
          continue;
        }
        fail(friendlyError(msg, sent), { attempts: attempt, mayHaveBeenSent: sent !== 'no' });
        log.warn({ err: msg, sent, attempts: attempt }, 'message failed');
        break;
      }
    }

    const s = this.settings.get();
    const [min, max] = job.imageId ? [s.imageMinDelaySeconds, s.imageMaxDelaySeconds] : [s.minDelaySeconds, s.maxDelaySeconds];
    this.nextSendAt = Date.now() + (min + Math.random() * (max - min)) * 1000;
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

export function friendlyError(msg: string, sent: 'no' | 'maybe' | 'partial'): string {
  if (sent === 'partial') return `${msg}. Check the group before retrying.`;
  if (/chat not found|invalid wid|no lid/i.test(msg)) return 'This group could not be found, so nothing was sent. Ask an admin to refresh groups.';
  if (sent === 'no') return `Nothing was sent (${msg.slice(0, 160)}). Tried twice.`;
  if (/timed out/i.test(msg)) return 'WhatsApp didn’t confirm in time. The message may still have been sent: check the group before retrying.';
  return `WhatsApp did not accept the message (${msg.slice(0, 160)}). Check the group before retrying.`;
}
