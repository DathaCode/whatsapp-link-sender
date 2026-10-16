import { and, asc, desc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import type { Db } from './db/index.js';
import { jobs, sendResults, users, type JobStatus, type ResultStatus, type WaitReason } from './db/schema.js';
import type { Platform } from './urls.js';

export interface JobItem {
  id: number;
  groupId: string;
  groupName: string;
  status: ResultStatus;
  error: string | null;
  attemptedAt: number | null;
  connectionId: number | null;
}

export interface Job {
  id: number;
  userId: number;
  username: string;
  url: string;
  platform: Platform;
  templateId: number | null;
  presetIds: number[];
  status: JobStatus;
  waitReason: WaitReason;
  parentJobId: number | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  total: number;
  sent: number;
  failed: number;
  pending: number;
  items?: JobItem[];
}

const counts = {
  total: sql<number>`(select count(*) from send_results r where r.job_id = ${jobs.id})`,
  sent: sql<number>`(select count(*) from send_results r where r.job_id = ${jobs.id} and r.status = 'sent')`,
  failed: sql<number>`(select count(*) from send_results r where r.job_id = ${jobs.id} and r.status = 'failed')`,
  pending: sql<number>`(select count(*) from send_results r where r.job_id = ${jobs.id} and r.status in ('pending','sending'))`,
};

export class JobStore {
  constructor(private db: Db) {}

  private select(where: SQL | undefined) {
    return this.db
      .select({ j: jobs, username: users.username, ...counts })
      .from(jobs)
      .innerJoin(users, eq(users.id, jobs.userId))
      .where(where);
  }

  private toJob(r: { j: typeof jobs.$inferSelect; username: string; total: number; sent: number; failed: number; pending: number }): Job {
    return {
      id: r.j.id,
      userId: r.j.userId,
      username: r.username,
      url: r.j.url,
      platform: r.j.platform as Platform,
      templateId: r.j.templateId,
      presetIds: JSON.parse(r.j.presetIds) as number[],
      status: r.j.status,
      waitReason: r.j.waitReason,
      parentJobId: r.j.parentJobId,
      createdAt: r.j.createdAt,
      startedAt: r.j.startedAt,
      finishedAt: r.j.finishedAt,
      total: Number(r.total),
      sent: Number(r.sent),
      failed: Number(r.failed),
      pending: Number(r.pending),
    };
  }

  create(input: {
    userId: number;
    url: string;
    platform: Platform;
    templateId: number | null;
    presetIds: number[];
    parentJobId: number | null;
    requestedConnectionId: number | null;
    groups: { id: string; name: string }[];
  }): number {
    return this.db.transaction((tx) => {
      const j = tx
        .insert(jobs)
        .values({
          userId: input.userId,
          url: input.url,
          platform: input.platform,
          templateId: input.templateId,
          presetIds: JSON.stringify(input.presetIds),
          status: 'queued',
          parentJobId: input.parentJobId,
          requestedConnectionId: input.requestedConnectionId,
          createdAt: Date.now(),
        })
        .returning({ id: jobs.id })
        .get();
      tx.insert(sendResults)
        .values(input.groups.map((g) => ({ jobId: j.id, groupId: g.id, groupName: g.name, status: 'pending' as const })))
        .run();
      return j.id;
    });
  }

  get(id: number): Job | undefined {
    const r = this.select(eq(jobs.id, id)).get();
    if (!r) return undefined;
    const items = this.db
      .select({
        id: sendResults.id,
        groupId: sendResults.groupId,
        groupName: sendResults.groupName,
        status: sendResults.status,
        error: sendResults.error,
        attemptedAt: sendResults.attemptedAt,
        connectionId: sendResults.connectionId,
      })
      .from(sendResults)
      .where(eq(sendResults.jobId, id))
      .orderBy(asc(sendResults.id))
      .all();
    return { ...this.toJob(r), items };
  }

  list(opts: { userId?: number; search?: string; limit: number; offset: number }): Job[] {
    const c: SQL[] = [];
    if (opts.userId !== undefined) c.push(eq(jobs.userId, opts.userId));
    if (opts.search) {
      const q = `%${opts.search.replace(/[\\%_]/g, (ch) => '\\' + ch)}%`;
      c.push(sql`${jobs.url} LIKE ${q} ESCAPE '\\'`);
    }
    return this.select(c.length ? and(...c) : undefined)
      .orderBy(desc(jobs.id))
      .limit(opts.limit)
      .offset(opts.offset)
      .all()
      .map((r) => this.toJob(r));
  }

  /** Jobs that still have work to do, oldest first. */
  active(): Job[] {
    return this.select(inArray(jobs.status, ['queued', 'running', 'waiting']))
      .orderBy(asc(jobs.id))
      .all()
      .map((r) => this.toJob(r));
  }

  lastSendOfUrl(url: string): { jobId: number; at: number; groups: number; by: string } | undefined {
    const r = this.select(and(eq(jobs.url, url), ne(jobs.status, 'cancelled')))
      .orderBy(desc(jobs.id))
      .limit(1)
      .get();
    return r ? { jobId: r.j.id, at: r.j.createdAt, groups: Number(r.sent), by: r.username } : undefined;
  }

  setStatus(id: number, status: JobStatus, waitReason: WaitReason = null, cancelledBy?: number) {
    const now = Date.now();
    const j = this.db.select().from(jobs).where(eq(jobs.id, id)).get();
    if (!j) return;
    this.db
      .update(jobs)
      .set({
        status,
        waitReason,
        startedAt: status === 'running' && !j.startedAt ? now : j.startedAt,
        finishedAt: status === 'done' || status === 'cancelled' ? now : j.finishedAt,
        ...(cancelledBy ? { cancelledBy } : {}),
      })
      .where(eq(jobs.id, id))
      .run();
  }

  nextPending(jobId: number): JobItem | undefined {
    return this.db
      .select({
        id: sendResults.id,
        groupId: sendResults.groupId,
        groupName: sendResults.groupName,
        status: sendResults.status,
        error: sendResults.error,
        attemptedAt: sendResults.attemptedAt,
        connectionId: sendResults.connectionId,
      })
      .from(sendResults)
      .where(and(eq(sendResults.jobId, jobId), eq(sendResults.status, 'pending')))
      .orderBy(asc(sendResults.id))
      .limit(1)
      .get();
  }

  markSending(itemId: number, message: string, day: string, connectionId: number) {
    this.db
      .update(sendResults)
      .set({ status: 'sending', message, attemptedAt: Date.now(), day, connectionId, error: null })
      .where(eq(sendResults.id, itemId))
      .run();
  }

  finish(itemId: number, status: 'sent' | 'failed' | 'pending' | 'cancelled', error: string | null = null, auditId: number | null = null) {
    this.db
      .update(sendResults)
      .set({
        status,
        error,
        ...(auditId ? { auditId } : {}),
        // Back to pending = not attempted; don't count it against the daily cap.
        ...(status === 'pending' ? { day: null, attemptedAt: null } : {}),
      })
      .where(eq(sendResults.id, itemId))
      .run();
  }

  cancelPending(jobId: number): number {
    return this.db
      .update(sendResults)
      .set({ status: 'cancelled' })
      .where(and(eq(sendResults.jobId, jobId), eq(sendResults.status, 'pending')))
      .run().changes;
  }

  /** After a crash we can't know whether an in-flight message went out: mark failed, never resend. */
  recoverInterrupted(): JobItem[] {
    const rows = this.db
      .select({
        id: sendResults.id,
        groupId: sendResults.groupId,
        groupName: sendResults.groupName,
        status: sendResults.status,
        error: sendResults.error,
        attemptedAt: sendResults.attemptedAt,
        connectionId: sendResults.connectionId,
      })
      .from(sendResults)
      .where(eq(sendResults.status, 'sending'))
      .all();
    if (rows.length) {
      this.db
        .update(sendResults)
        .set({ status: 'failed', error: 'The app restarted while sending. Check the group, then use “Retry failed” if needed.' })
        .where(eq(sendResults.status, 'sending'))
        .run();
    }
    return rows;
  }

  failedItems(jobId: number): { id: string; name: string }[] {
    return this.db
      .select({ id: sendResults.groupId, name: sendResults.groupName })
      .from(sendResults)
      .where(and(eq(sendResults.jobId, jobId), eq(sendResults.status, 'failed')))
      .orderBy(asc(sendResults.id))
      .all();
  }

  hasCancelledItems(jobId: number): boolean {
    return !!this.db
      .select({ id: sendResults.id })
      .from(sendResults)
      .where(and(eq(sendResults.jobId, jobId), eq(sendResults.status, 'cancelled')))
      .get();
  }

  recentFailures(limit: number) {
    return this.db
      .select({
        id: sendResults.id,
        jobId: sendResults.jobId,
        groupName: sendResults.groupName,
        error: sendResults.error,
        attemptedAt: sendResults.attemptedAt,
        url: jobs.url,
        username: users.username,
      })
      .from(sendResults)
      .innerJoin(jobs, eq(jobs.id, sendResults.jobId))
      .innerJoin(users, eq(users.id, jobs.userId))
      .where(eq(sendResults.status, 'failed'))
      .orderBy(desc(sendResults.attemptedAt))
      .limit(limit)
      .all();
  }

  ownerOf(jobId: number) {
    return this.db
      .select({ id: users.id, username: users.username, role: users.role })
      .from(jobs)
      .innerJoin(users, eq(users.id, jobs.userId))
      .where(eq(jobs.id, jobId))
      .get();
  }
}
