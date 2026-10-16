import type { Config } from './config.js';
import type { Job, JobItem, Store, Template, WaitReason } from './db.js';
import type { EventHub } from './events.js';
import type { Logger } from './logger.js';
import type { Settings } from './settings.js';
import { inWindow, localTime } from './time.js';
import type { Platform } from './urls.js';
import { NotConnectedError, type WhatsApp } from './whatsapp.js';

export interface QueueStatus {
  activeJobId: number | null;
  waitReason: WaitReason;
  nextSendAt: number | null;
  queued: number;
}

export function renderTemplate(body: string, url: string): string {
  return body.includes('{url}') ? body.replaceAll('{url}', url) : `${body.trim()}\n${url}`.trim();
}

/**
 * The single send worker. Jobs live in SQLite, so anything not yet sent survives a
 * restart. Exactly one message is in flight at a time, and every safety rule
 * (pause, daily cap, sending hours) is checked here, on the server.
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
    private store: Store,
    private wa: WhatsApp,
    private settings: Settings,
    private hub: EventHub,
    private log: Logger,
  ) {}

  start() {
    const recovered = this.store.recoverInterruptedItems();
    if (recovered) this.log.warn({ recovered }, 'marked messages interrupted by a restart as failed');
    // Be polite after a restart too: wait at least the minimum pause before the first send.
    this.nextSendAt = Date.now() + this.settings.get().minDelaySeconds * 1000;
    this.loopDone = this.loop().catch((e) => this.log.fatal({ err: String(e) }, 'send loop crashed'));
  }

  /** Re-check right away (new job, cancel, settings change, WhatsApp back online). */
  kick() {
    this.wakeUp?.();
  }

  getStatus(): QueueStatus {
    return { ...this.status };
  }

  today() {
    return localTime(new Date(), this.cfg.TZ).day;
  }

  usage() {
    const s = this.settings.get();
    return { day: this.today(), used: this.store.usageOn(this.today()), cap: s.dailyCap };
  }

  enqueue(input: {
    url: string;
    platform: Platform;
    templateId: number | null;
    parentJobId?: number | null;
    groups: { id: string; name: string }[];
  }): number {
    const id = this.store.createJob({ ...input, parentJobId: input.parentJobId ?? null });
    this.log.info({ jobId: id, groups: input.groups.length, url: input.url }, 'send job queued');
    this.emitJob(id);
    this.kick();
    return id;
  }

  cancel(jobId: number): boolean {
    const job = this.store.getJob(jobId);
    if (!job || job.status === 'done' || job.status === 'cancelled') return false;
    this.store.cancelPendingItems(jobId);
    // A message being sent right now finishes on its own; the loop then closes the job.
    if (!job.items.some((i) => i.status === 'sending')) this.store.setJobStatus(jobId, 'cancelled');
    this.log.info({ jobId }, 'send job cancelled');
    this.emitJob(jobId);
    this.kick();
    return true;
  }

  private blockReason(): WaitReason {
    const s = this.settings.get();
    if (!this.wa.isReady()) return 'whatsapp_offline';
    const now = localTime(new Date(), this.cfg.TZ);
    if (!inWindow(now.minutes, s.windowStart, s.windowEnd)) return 'outside_hours';
    if (this.store.usageOn(now.day) >= s.dailyCap) return 'daily_cap';
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
    if (
      s.activeJobId !== next.activeJobId ||
      s.waitReason !== next.waitReason ||
      s.nextSendAt !== next.nextSendAt ||
      s.queued !== next.queued
    ) {
      this.status = next;
      this.hub.emit('queue', next);
    }
  }

  private async loop() {
    while (!this.stopping) {
      const active = this.store.activeJobs();
      const job = active[0];
      if (!job) {
        this.setStatus({ activeJobId: null, waitReason: null, nextSendAt: null, queued: 0 });
        await this.sleep(60_000);
        continue;
      }

      const item = this.store.nextPendingItem(job.id);
      if (!item) {
        const wasCancelled = this.store.getJob(job.id)?.items.some((i) => i.status === 'cancelled');
        this.store.setJobStatus(job.id, wasCancelled ? 'cancelled' : 'done');
        this.log.info({ jobId: job.id }, 'send job finished');
        this.emitJob(job.id);
        continue;
      }

      const block = this.blockReason();
      if (block) {
        if (job.status !== 'waiting' || job.waitReason !== block) {
          this.store.setJobStatus(job.id, 'waiting', block);
          this.log.info({ jobId: job.id, reason: block }, 'send job waiting');
          this.emitJob(job.id);
        }
        this.setStatus({ activeJobId: job.id, waitReason: block, nextSendAt: null, queued: active.length - 1 });
        await this.sleep(30_000);
        continue;
      }

      if (job.status !== 'running') {
        this.store.setJobStatus(job.id, 'running');
        this.emitJob(job.id);
      }

      const wait = this.nextSendAt - Date.now();
      this.setStatus({
        activeJobId: job.id,
        waitReason: null,
        nextSendAt: wait > 0 ? this.nextSendAt : Date.now(),
        queued: active.length - 1,
      });
      if (wait > 0) {
        await this.sleep(wait);
        continue; // re-check everything: the job may have been cancelled meanwhile
      }

      await this.sendItem(job, item);
    }
  }

  private pickTemplate(templateId: number | null): Template | null {
    const all = this.store.listTemplates();
    if (templateId !== null) {
      const chosen = all.find((t) => t.id === templateId);
      if (chosen) return chosen;
    }
    // Rotate: random active template, avoiding the one used last time.
    const pool = all.filter((t) => t.active);
    if (pool.length === 0) return null;
    const fresh = pool.length > 1 ? pool.filter((t) => t.id !== this.lastTemplateId) : pool;
    return fresh[Math.floor(Math.random() * fresh.length)] ?? null;
  }

  private async sendItem(job: Job, item: JobItem) {
    const group = this.store.listGroups().find((g) => g.id === item.groupId);
    if (group?.readOnly) {
      this.store.finishItem(item.id, 'failed', 'Only admins can post in this group, or this number left it.');
      this.emitJob(job.id);
      return;
    }

    const template = this.pickTemplate(job.templateId);
    this.lastTemplateId = template?.id ?? null;
    const text = template ? renderTemplate(template.body, job.url) : job.url;
    const day = this.today();

    this.store.markItemSending(item.id, text, day);
    this.emitJob(job.id);
    const log = this.log.child({ jobId: job.id, itemId: item.id, group: item.groupName });

    try {
      await this.wa.sendText(item.groupId, text);
      this.store.finishItem(item.id, 'sent');
      log.info('message sent');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (e instanceof NotConnectedError || !this.wa.isReady()) {
        // Not this group's fault: put it back and wait for the connection.
        this.store.finishItem(item.id, 'pending');
        log.warn({ err: msg }, 'send interrupted by connection loss; will retry');
      } else {
        this.store.finishItem(item.id, 'failed', friendlyError(msg));
        log.warn({ err: msg }, 'message failed');
      }
    }

    const s = this.settings.get();
    const delay = (s.minDelaySeconds + Math.random() * (s.maxDelaySeconds - s.minDelaySeconds)) * 1000;
    this.nextSendAt = Date.now() + delay;
    this.emitJob(job.id);
    this.hub.emit('usage', this.usage());
  }

  private emitJob(id: number) {
    const job = this.store.getJob(id);
    if (job) this.hub.emit('job', job);
  }

  async stop() {
    this.stopping = true;
    this.kick();
    if (this.loopDone) {
      await Promise.race([this.loopDone, new Promise((r) => setTimeout(r, 15_000))]);
    }
  }
}

function friendlyError(msg: string): string {
  if (/timed out/i.test(msg)) return 'WhatsApp took too long to respond. Try again later.';
  if (/not.*found|invalid wid|no lid/i.test(msg)) return 'This group could not be found. Press “Refresh groups”.';
  return `WhatsApp did not accept the message (${msg.slice(0, 160)}).`;
}
