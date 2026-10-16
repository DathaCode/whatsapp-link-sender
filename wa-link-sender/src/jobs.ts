import { and, asc, desc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import type { Db } from './db/index.js';
import { connections, jobMainLinks, jobs, sendResults, users, type JobStatus, type ResultStatus, type WaitReason } from './db/schema.js';
import { canonicalLink, type MessageLink } from './message.js';

export interface JobItem {
  id: number;
  groupId: string;
  groupName: string;
  status: ResultStatus;
  error: string | null;
  attemptedAt: number | null;
  connectionId: number | null;
}

export type SendMode = 'text' | 'single' | 'two';

export interface Job {
  id: number;
  userId: number;
  username: string;
  /** v2 jobs: the post URL. New jobs: first main link (may be ''). */
  url: string;
  /** v2 jobs: facebook | tiktok | youtube. New jobs: 'message'. */
  platform: string;
  /** Exact text sent (null for v2 jobs: see items[].message). */
  messageText: string | null;
  messageSha256: string | null;
  imageId: string | null;
  imageSha256: string | null;
  sendMode: SendMode | null;
  links: MessageLink[];
  warnings: Record<string, unknown> | null;
  connectionLabel: string | null;
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

export interface NewJob {
  userId: number;
  messageText: string;
  messageSha256: string;
  textKey: string;
  imageId: string | null;
  imageSha256: string | null;
  sendMode: SendMode;
  links: MessageLink[];
  mainLinks: string[];
  warnings: Record<string, unknown> | null;
  presetIds: number[];
  parentJobId: number | null;
  requestedConnectionId: number | null;
  groups: { id: string; name: string }[];
}

export class JobStore {
  constructor(private db: Db) {}

  private select(where: SQL | undefined) {
    return this.db
      .select({ j: jobs, username: users.username, connectionLabel: connections.label, ...counts })
      .from(jobs)
      .innerJoin(users, eq(users.id, jobs.userId))
      .leftJoin(connections, eq(connections.id, jobs.requestedConnectionId))
      .where(where);
  }

  /** Old (pre-message) jobs: index their URL as a main link once, so duplicate checks still see them. */
  backfillMainLinks() {
    const old = this.db
      .select({ id: jobs.id, url: jobs.url })
      .from(jobs)
      .where(sql`${jobs.messageText} IS NULL AND ${jobs.url} != '' AND NOT EXISTS (SELECT 1 FROM job_main_links m WHERE m.job_id = ${jobs.id})`)
      .all();
    for (const j of old) this.db.insert(jobMainLinks).values({ jobId: j.id, link: canonicalLink(j.url) }).onConflictDoNothing().run();
    return old.length;
  }

  private toJob(r: {
    j: typeof jobs.$inferSelect;
    username: string;
    connectionLabel: string | null;
    total: number;
    sent: number;
    failed: number;
    pending: number;
  }): Job {
    return {
      id: r.j.id,
      userId: r.j.userId,
      username: r.username,
      url: r.j.url,
      platform: r.j.platform,
      messageText: r.j.messageText,
      messageSha256: r.j.messageSha256,
      imageId: r.j.imageId,
      imageSha256: r.j.imageSha256,
      sendMode: r.j.sendMode,
      links: r.j.links ? (JSON.parse(r.j.links) as MessageLink[]) : [],
      warnings: r.j.warnings ? (JSON.parse(r.j.warnings) as Record<string, unknown>) : null,
      connectionLabel: r.connectionLabel,
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

  create(input: NewJob): number {
    const firstMain = input.mainLinks[0];
    const url = firstMain ? (input.links.find((l) => canonicalLink(l.cleaned) === firstMain)?.cleaned ?? '') : '';
    return this.db.transaction((tx) => {
      const j = tx
        .insert(jobs)
        .values({
          userId: input.userId,
          url,
          platform: 'message',
          messageText: input.messageText,
          messageSha256: input.messageSha256,
          textKey: input.textKey,
          imageId: input.imageId,
          imageSha256: input.imageSha256,
          sendMode: input.sendMode,
          links: JSON.stringify(input.links),
          warnings: input.warnings ? JSON.stringify(input.warnings) : null,
          presetIds: JSON.stringify(input.presetIds),
          status: 'queued',
          parentJobId: input.parentJobId,
          requestedConnectionId: input.requestedConnectionId,
          createdAt: Date.now(),
        })
        .returning({ id: jobs.id })
        .get();
      tx.insert(sendResults)
        .values(
          input.groups.map((g) => ({
            jobId: j.id,
            groupId: g.id,
            groupName: g.name,
            status: 'pending' as const,
            messagesCount: input.sendMode === 'two' ? 2 : 1,
          })),
        )
        .run();
      for (const link of new Set(input.mainLinks)) tx.insert(jobMainLinks).values({ jobId: j.id, link }).onConflictDoNothing().run();
      return j.id;
    });
  }

  /**
   * The most recent earlier send that matches: same text (whitespace-insensitive), same image,
   * or any shared main link. Cancelled sends don't count.
   */
  findDuplicate(q: { textKey: string; imageSha256: string | null; mainLinks: string[] }) {
    const pick = (where: SQL) =>
      this.select(and(where, ne(jobs.status, 'cancelled')))
        .orderBy(desc(jobs.id))
        .limit(1)
        .get();
    const found: { row: NonNullable<ReturnType<typeof pick>>; why: string }[] = [];
    const byText = pick(eq(jobs.textKey, q.textKey));
    if (byText) found.push({ row: byText, why: 'same message text' });
    if (q.imageSha256) {
      const byImage = pick(eq(jobs.imageSha256, q.imageSha256));
      if (byImage) found.push({ row: byImage, why: 'same image' });
    }
    for (const link of q.mainLinks) {
      const byLink = pick(sql`EXISTS (SELECT 1 FROM job_main_links m WHERE m.job_id = ${jobs.id} AND m.link = ${link})`);
      if (byLink) found.push({ row: byLink, why: `same link: ${link}` });
    }
    if (!found.length) return undefined;
    found.sort((a, b) => b.row.j.id - a.row.j.id);
    const latest = found[0]!.row;
    return {
      jobId: latest.j.id,
      at: latest.j.createdAt,
      groups: Number(latest.sent),
      by: latest.username,
      reasons: [...new Set(found.map((f) => f.why))],
    };
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
      c.push(sql`(${jobs.url} LIKE ${q} ESCAPE '\\' OR ${jobs.messageText} LIKE ${q} ESCAPE '\\')`);
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

  markSending(itemId: number, message: string, day: string, connectionId: number, messagesCount: number) {
    this.db
      .update(sendResults)
      .set({ status: 'sending', message, attemptedAt: Date.now(), day, connectionId, error: null, messagesCount, attempts: sql`${sendResults.attempts} + 1` })
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
        messageText: jobs.messageText,
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
