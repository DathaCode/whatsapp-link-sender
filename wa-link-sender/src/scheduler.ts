import { eq } from 'drizzle-orm';
import { SYSTEM, type AuditLog } from './audit.js';
import type { Backups } from './backups.js';
import type { Images } from './images.js';
import type { Config } from './config.js';
import type { Db } from './db/index.js';
import { settings } from './db/schema.js';
import type { Logger } from './logger.js';
import { localTime, parseHHMM } from './time.js';

interface DailyJob {
  key: string;
  at: string; // HH:MM in TZ
  run: () => void;
}

/**
 * Minimal daily scheduler (checked every minute, in TZ). Each job runs once per local day
 * at or after its time; the last-run day is stored in the database so restarts don't repeat it.
 */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private jobs: DailyJob[];

  constructor(
    private cfg: Config,
    private db: Db,
    backups: Backups,
    audit: AuditLog,
    images: Images,
    private log: Logger,
  ) {
    this.jobs = [
      { key: 'job.backup.lastDay', at: '02:30', run: () => backups.create(SYSTEM, 'nightly') },
      { key: 'job.auditPrune.lastDay', at: '03:00', run: () => audit.prune(cfg.AUDIT_RETENTION_DAYS) },
      { key: 'job.uploadPrune.lastDay', at: '03:30', run: () => images.prune(cfg.UPLOAD_RETENTION_DAYS) },
    ];
  }

  start() {
    this.tick();
    this.timer = setInterval(() => this.tick(), 60_000);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  private lastDay(key: string): string | null {
    const row = this.db.select().from(settings).where(eq(settings.key, key)).get();
    return row ? (JSON.parse(row.value) as string) : null;
  }

  private setLastDay(key: string, day: string) {
    this.db
      .insert(settings)
      .values({ key, value: JSON.stringify(day) })
      .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(day) } })
      .run();
  }

  private tick() {
    const now = localTime(new Date(), this.cfg.TZ);
    for (const job of this.jobs) {
      if (now.minutes < parseHHMM(job.at) || this.lastDay(job.key) === now.day) continue;
      this.setLastDay(job.key, now.day); // mark first so a failing job doesn't retry every minute
      try {
        job.run();
      } catch (e) {
        this.log.error({ job: job.key, err: e instanceof Error ? e.message : String(e) }, 'scheduled job failed');
      }
    }
  }
}
